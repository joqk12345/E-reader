#!/usr/bin/env node
import process from 'node:process';
import { createReaderMcpServer } from './server.mjs';
import { callTool, getTools } from './tools/markdown-tools.mjs';
import { logLine } from './utils/log.mjs';

logLine(`boot pid=${process.pid} cwd=${process.cwd()} argv=${JSON.stringify(process.argv)}`);
process.on('uncaughtException', (err) => {
  logLine(`uncaughtException ${err?.stack || err}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logLine(`unhandledRejection ${err?.stack || err}`);
  process.exit(1);
});

function printHelp() {
  console.log(`Reader CLI

Usage:
  reader-mcp-server stdio
  reader-mcp-server tools
  reader-mcp-server tool <tool_name> [--args '{"k":"v"}'] [--pretty]
  reader-mcp-server import <file> [--title ...] [--author ...] [--language ...] [--force-reimport]
  reader-mcp-server search <query> [--doc-id ...|--path ...|--title ...] [--limit 20]
  reader-mcp-server summary [--doc-id ...|--path ...|--title ...|--section-id ...|--paragraph-id ...] [--style brief|detailed|bullet]
  reader-mcp-server translate <text> --target-lang zh|en
  reader-mcp-server deep [--doc-id ...|--path ...|--title ...|--section-id ...|--paragraph-id ...]
  reader-mcp-server chat <question> [--doc-id ...|--path ...|--title ...|--section-id ...|--paragraph-id ...]

Common options:
  --db-path <path>      Override reader.db path
  --provider <name>     lmstudio | openai
  --chat-model <model>  Override chat model
  --pretty              Pretty-print JSON output
`);
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { positional, flags };
}

function hasAnyContextSelector(flags) {
  return Boolean(
    flags['doc-id'] || flags.path || flags.title || flags['section-id'] || flags['paragraph-id']
  );
}

function buildBaseArgs(flags) {
  const args = {};
  if (flags['db-path']) args.db_path = String(flags['db-path']);
  if (flags.provider) args.provider = String(flags.provider);
  if (flags['chat-model']) args.chat_model = String(flags['chat-model']);
  if (flags['lm-studio-url']) args.lm_studio_url = String(flags['lm-studio-url']);
  if (flags['openai-base-url']) args.openai_base_url = String(flags['openai-base-url']);
  if (flags['openai-api-key']) args.openai_api_key = String(flags['openai-api-key']);
  if (flags['doc-id']) args.doc_id = String(flags['doc-id']);
  if (flags.path) args.path = String(flags.path);
  if (flags.title) args.title = String(flags.title);
  if (flags['section-id']) args.section_id = String(flags['section-id']);
  if (flags['paragraph-id']) args.paragraph_id = String(flags['paragraph-id']);
  return args;
}

async function runCli(argv) {
  const { positional, flags } = parseCliArgs(argv);
  const command = positional[0];
  const root = process.cwd();
  const pretty = Boolean(flags.pretty);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'stdio') {
    const server = createReaderMcpServer({ root });
    process.stdin.on('data', (chunk) => server.onData(chunk));
    process.stdin.resume();
    return;
  }

  if (command === 'tools') {
    const payload = getTools().map((tool) => ({ name: tool.name, description: tool.description }));
    console.log(JSON.stringify(payload, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'tool') {
    const toolName = positional[1];
    if (!toolName) throw new Error('tool name is required');
    const rawArgs = flags.args ? JSON.parse(String(flags.args)) : {};
    const mergedArgs = { ...buildBaseArgs(flags), ...rawArgs };
    const result = await callTool(root, toolName, mergedArgs);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'import') {
    const filePath = positional[1];
    if (!filePath) throw new Error('import requires file path');
    const args = {
      ...buildBaseArgs(flags),
      path: filePath,
      force_reimport: Boolean(flags['force-reimport']),
    };
    if (flags.author) args.author = String(flags.author);
    if (flags.language) args.language = String(flags.language);
    if (flags.title) args.title = String(flags.title);
    const result = await callTool(root, 'reader.import_document', args);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'search') {
    const query = positional.slice(1).join(' ').trim();
    if (!query) throw new Error('search requires query');
    const limit = Number.parseInt(String(flags.limit || ''), 10);
    const args = {
      ...buildBaseArgs(flags),
      query,
      limit: Number.isInteger(limit) ? limit : undefined,
      case_sensitive: Boolean(flags['case-sensitive']),
    };
    const result = await callTool(root, 'reader.search_markdown', args);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'summary') {
    if (!hasAnyContextSelector(flags)) {
      throw new Error(
        'summary requires context selector: --doc-id/--path/--title/--section-id/--paragraph-id'
      );
    }
    const args = {
      ...buildBaseArgs(flags),
      style: String(flags.style || 'brief'),
    };
    const result = await callTool(root, 'reader.summarize_context', args);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'translate') {
    const text = positional.slice(1).join(' ').trim();
    if (!text) throw new Error('translate requires text');
    const targetLang = String(flags['target-lang'] || '').trim();
    if (!targetLang) throw new Error('translate requires --target-lang');
    const args = {
      ...buildBaseArgs(flags),
      text,
      target_lang: targetLang,
    };
    const result = await callTool(root, 'reader.translate_text', args);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'deep') {
    if (!hasAnyContextSelector(flags)) {
      throw new Error(
        'deep requires context selector: --doc-id/--path/--title/--section-id/--paragraph-id'
      );
    }
    const result = await callTool(root, 'reader.deep_analyze_context', buildBaseArgs(flags));
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  if (command === 'chat') {
    const question = positional.slice(1).join(' ').trim();
    if (!question) throw new Error('chat requires question');
    if (!hasAnyContextSelector(flags)) {
      throw new Error(
        'chat requires context selector: --doc-id/--path/--title/--section-id/--paragraph-id'
      );
    }
    const args = {
      ...buildBaseArgs(flags),
      question,
    };
    const result = await callTool(root, 'reader.chat_with_context', args);
    console.log(JSON.stringify(result, null, pretty ? 2 : 0));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
  const server = createReaderMcpServer({ root: process.cwd() });
  process.stdin.on('data', (chunk) => server.onData(chunk));
  process.stdin.resume();
} else {
  runCli(userArgs).catch((error) => {
    const message = String(error?.message || error);
    console.error(message);
    process.exit(1);
  });
}
