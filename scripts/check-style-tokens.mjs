import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Expand this boundary after each migration phase. Legacy files are not certified.
const files = ['src/components/settings/SettingsUI.tsx'];
function collect(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(name);
    else if (/\.(tsx?|css)$/.test(name)) files.push(name);
  }
}
collect('src/components/ui');
const rules = [
  ['raw color', /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i],
  ['palette utility', /\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to|shadow|decoration|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/],
  ['arbitrary visual utility', /\b(?:text|bg|border|rounded|shadow|p[xytrbl]?|m[xytrbl]?|gap|w|h|min-w|max-w|min-h|max-h|leading|tracking)-\[/],
];
const failures = [];
for (const file of files) {
  readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
    for (const [label, pattern] of rules) {
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: ${label}`);
    }
  });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Style token checks passed for ${files.length} migrated files (not the entire app).`);
