import { callTool, getResources, getTools, readResource } from './tools/markdown-tools.mjs';
import { logLine } from './utils/log.mjs';

function findHeaderEnd(buf) {
  const crlf = Buffer.from('\r\n\r\n');
  const lf = Buffer.from('\n\n');
  const crlfPos = buf.indexOf(crlf);
  if (crlfPos !== -1) return { index: crlfPos, sepLength: crlf.length };
  const lfPos = buf.indexOf(lf);
  if (lfPos !== -1) return { index: lfPos, sepLength: lf.length };
  return null;
}

function writeMessage(msg) {
  // Placeholder replaced inside createReaderMcpServer for transport-aware writing.
  const json = JSON.stringify(msg);
  const bytes = Buffer.from(json, 'utf8');
  process.stdout.write(`Content-Length: ${bytes.length}\r\n\r\n`);
  process.stdout.write(bytes);
}

function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

function toolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function resourceResult(uri, payload) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createReaderMcpServer({ root }) {
  const tools = getTools();
  const resources = getResources();
  let readBuffer = Buffer.alloc(0);
  let rawJsonMode = false;
  let responseMode = 'framed'; // 'framed' | 'raw'

  function sendMessage(msg) {
    const json = JSON.stringify(msg);
    if (responseMode === 'raw') {
      process.stdout.write(`${json}\n`);
      return;
    }
    const bytes = Buffer.from(json, 'utf8');
    process.stdout.write(`Content-Length: ${bytes.length}\r\n\r\n`);
    process.stdout.write(bytes);
  }

  function tryParseMessage() {
    // Fallback mode: some clients may send raw JSON-RPC without Content-Length framing.
    if (rawJsonMode) {
      responseMode = 'raw';
      const text = readBuffer.toString('utf8').trim();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        readBuffer = Buffer.alloc(0);
        return parsed;
      } catch {
        return null;
      }
    }

    const headerInfo = findHeaderEnd(readBuffer);
    if (!headerInfo) {
      const trimmed = readBuffer.toString('utf8').trimStart();
      if (trimmed.startsWith('{')) {
        rawJsonMode = true;
        responseMode = 'raw';
        // Parse immediately from current buffer; don't wait for next chunk.
        const text = readBuffer.toString('utf8').trim();
        try {
          const parsed = JSON.parse(text);
          readBuffer = Buffer.alloc(0);
          return parsed;
        } catch {
          return null;
        }
      }
      return null;
    }
    const headerEnd = headerInfo.index;
    responseMode = 'framed';
    const headerText = readBuffer.slice(0, headerEnd).toString('utf8');
    const contentLengthLine = headerText
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().startsWith('content-length:'));

    if (!contentLengthLine) {
      throw new Error('Missing Content-Length header');
    }

    const contentLength = Number(contentLengthLine.split(':')[1].trim());
    const bodyStart = headerEnd + headerInfo.sepLength;
    const bodyEnd = bodyStart + contentLength;
    if (readBuffer.length < bodyEnd) return null;

    const body = readBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    readBuffer = readBuffer.slice(bodyEnd);
    return JSON.parse(body);
  }

  function handleRequest(msg) {
    const id = Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : undefined;
    const method = msg?.method;
    logLine(`request method=${String(method)} id=${id === undefined ? 'none' : String(id)}`);

    if (!id && method === 'notifications/initialized') {
      return;
    }

    if (method === 'initialize') {
      const requestedProtocolVersion =
        msg?.params?.protocolVersion && typeof msg.params.protocolVersion === 'string'
          ? msg.params.protocolVersion
          : '2025-11-25';
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requestedProtocolVersion,
          serverInfo: { name: 'reader-mcp-server', version: '0.1.0' },
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
          },
        },
      });
      return;
    }

    if (method === 'tools/list') {
      sendMessage({ jsonrpc: '2.0', id, result: { tools } });
      return;
    }

    if (method === 'resources/list') {
      sendMessage({ jsonrpc: '2.0', id, result: { resources } });
      return;
    }

    if (method === 'resources/read') {
      const uri = String(msg?.params?.uri || '').trim();
      try {
        const payload = readResource(root, uri);
        sendMessage({ jsonrpc: '2.0', id, result: resourceResult(uri, payload) });
      } catch (error) {
        sendMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: String(error?.message || error) },
        });
      }
      return;
    }

    if (method === 'tools/call') {
      const toolName = msg?.params?.name;
      const args = msg?.params?.arguments || {};

      Promise.resolve()
        .then(() => callTool(root, toolName, args))
        .then((result) => {
          sendMessage({ jsonrpc: '2.0', id, result: toolResult(result) });
        })
        .catch((error) => {
          const message = String(error?.message || error);
          sendMessage({ jsonrpc: '2.0', id, result: toolError(message) });
        });
      return;
    }

    if (method === 'ping' || method === 'initialized' || method === 'notifications/initialized') {
      if (id !== undefined) {
        sendMessage({ jsonrpc: '2.0', id, result: {} });
      }
      return;
    }

    if (id !== undefined) {
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  }

  function onData(chunk) {
    const preview = chunk
      .toString('utf8')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .slice(0, 220);
    logLine(`stdin bytes=${chunk.length} preview=${preview}`);
    readBuffer = Buffer.concat([readBuffer, chunk]);
    while (true) {
      let msg;
      try {
        msg = tryParseMessage();
      } catch (error) {
        sendMessage({
          jsonrpc: '2.0',
          error: { code: -32700, message: String(error?.message || error) },
        });
        logLine(`parse_error ${String(error?.stack || error)}`);
        return;
      }

      if (!msg) break;
      handleRequest(msg);
    }
  }

  return { onData };
}
