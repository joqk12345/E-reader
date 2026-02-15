import fs from 'node:fs';

export const LOG_PATH = process.env.READER_MCP_LOG || '/tmp/reader-business-mcp.log';

export function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch {}
}
