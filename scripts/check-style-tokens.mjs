import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// The token source and reader theme palettes are the definitions that consumers reference.
const definitionFiles = new Set(['src/styles/tokens.css', 'src/components/readerTheme.ts']);
const files = [];
function collect(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(name);
    else if (/\.(tsx?|css)$/.test(name) && !definitionFiles.has(name)) files.push(name);
  }
}
collect('src');
const rules = [
  ['raw color', /#[\da-f]{3,8}\b|(?:rgba?|hsla?)\((?!\s*var\(--color-)[^)]*\)|(?:rgba?|hsla?)_[^\s\]]+/i],
  ['palette utility', /\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|shadow|decoration|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/],
  ['arbitrary font size', /\btext-\[[^\]]+\]/],
  ['default font size', /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/],
];
const failures = [];
for (const file of files) {
  readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
    for (const [label, pattern] of rules) {
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: ${label}`);
    }
    if (!file.startsWith('src/components/ui/') && /<\/?(?:button|input|select|textarea)\b/.test(line)) {
      failures.push(`${file}:${index + 1}: raw interactive element`);
    }
  });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Style token checks passed for ${files.length} application files.`);
