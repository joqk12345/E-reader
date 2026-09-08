import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const settings = read('src/components/Settings.tsx');
const settingsTypes = read('src/components/settings/settingsTypes.ts');
const theme = read('src/components/readerTheme.ts');

const sections = ['reading', 'editor', 'translation', 'ai', 'audio', 'shortcuts', 'integrations', 'about'];
for (const section of sections) {
  expect(settingsTypes.includes(`'${section}'`), `SettingsSection is missing ${section}`);
  expect(settings.includes(`{ id: '${section}',`), `Settings sidebar is missing ${section}`);
  expect(settings.includes(`activeSection === '${section}'`), `Settings content is missing ${section}`);
}

for (const themeId of ['white', 'paper', 'mint', 'sepia', 'night']) {
  expect(theme.includes(`${themeId}: {`), `Reader theme is missing ${themeId}`);
}

for (const relativePath of [
  'src/components/ui/Button.tsx',
  'src/components/ui/Dialog.tsx',
  'src/components/ui/Input.tsx',
  'src/components/ui/Select.tsx',
  'src/components/ui/Tabs.tsx',
  'src/components/ui/Checkbox.tsx',
  'src/components/ui/Range.tsx',
  'src/components/ui/Textarea.tsx',
  'src/features/library/useLibraryDocumentFilters.ts',
  'src/features/library/useLibraryImport.ts',
  'src/features/reader/useReaderAnnotations.ts',
  'src/features/reader/useReaderPanelLayout.ts',
  'src/features/reader/useReaderRenderModel.ts',
  'src/features/reader/useReaderTranslation.ts',
  'src/features/reader/useReaderViewSettings.ts',
  'src/features/reader/useSelectionActionOrder.ts',
]) {
  expect(existsSync(path.join(root, relativePath)), `Required boundary file is missing: ${relativePath}`);
}

expect(settings.includes('role="dialog"'), 'Settings shell is missing dialog semantics');
expect(settings.includes('aria-modal="true"'), 'Settings shell is missing aria-modal');
expect(settings.includes("event.key !== 'Tab'"), 'Settings shell is missing Tab focus handling');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Design boundary checks passed for ${sections.length} settings sections, 5 reader themes, and 15 shared boundaries.`);
}
