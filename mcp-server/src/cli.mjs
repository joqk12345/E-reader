#!/usr/bin/env node
import process from 'node:process';
import { createReaderMcpServer } from './server.mjs';
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

const server = createReaderMcpServer({ root: process.cwd() });
process.stdin.on('data', (chunk) => server.onData(chunk));
process.stdin.resume();
