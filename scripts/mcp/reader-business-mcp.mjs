#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const cliPath = path.join(rootDir, 'mcp-server/src/cli.mjs');
await import(pathToFileURL(cliPath).href);

process.stdin.resume();
