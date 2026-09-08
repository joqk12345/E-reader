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
const switchPrimitive = read('src/components/ui/Switch.tsx');
const libraryImport = read('src/features/library/useLibraryImport.ts');
const reader = read('src/components/Reader.tsx');
const readerContent = read('src/components/ReaderContent.tsx');
const readerTheme = read('src/components/readerTheme.ts');
const appTheme = read('src/components/appTheme.ts');
const appThemeHook = read('src/features/app/useAppTheme.ts');
const app = read('src/App.tsx');
const tokens = read('src/styles/tokens.css');

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
expect(settings.includes('aria-pressed={readerViewSettings.theme === id}'), 'Theme controls are missing pressed state');
expect(settings.includes('aria-label="Decrease font size"'), 'Typography controls are missing accessible labels');
expect(settings.includes('aria-label="Increase CJK letter spacing"'), 'CJK controls are missing accessible labels');
expect(switchPrimitive.includes('aria-label={label}'), 'Switch primitive is missing accessible label support');
expect(readerTheme.includes('export const persistReaderViewSettings'), 'Reader view persistence helper is missing');
expect(readerTheme.includes("new CustomEvent<ReaderViewSettings>('reader:view-settings-updated', { detail: settings })"), 'Reader view update event is missing settings detail');
expect(settings.includes('persistReaderViewSettings(readerViewSettings)'), 'Settings save path bypasses reader view persistence helper');
expect(settings.includes('aria-live="polite"'), 'Appearance page is missing live theme preview');
expect(appTheme.includes("'light' | 'dark' | 'system'"), 'App theme preference is missing light/dark/system options');
expect(appTheme.includes('APP_THEME_STORAGE_KEY'), 'App theme preference is missing persistence key');
expect(appTheme.includes('APP_THEME_EVENT'), 'App theme preference is missing update event');
expect(appThemeHook.includes('applyAppTheme'), 'App theme hook is missing document application');
expect(app.includes('useAppTheme()'), 'App shell is missing app theme subscription');
expect(settings.includes('title="App theme"'), 'Settings is missing app theme control');
expect(tokens.includes("[data-app-theme='dark']"), 'Application tokens are missing dark theme values');

for (const importKind of ['importEpub', 'importPdf', 'importMarkdown']) {
  expect(libraryImport.includes(importKind), `Library import boundary is missing ${importKind}`);
}
for (const readerSetting of ['layoutMode', 'bilingualViewMode', 'markdownRenderMode']) {
  expect(reader.includes(readerSetting) || readerContent.includes(readerSetting), `Reader flow is missing ${readerSetting}`);
}
for (const readerSetting of ['fontSize', 'lineHeight', 'contentWidth']) {
  expect(settings.includes(readerSetting) && readerContent.includes(readerSetting), `Reader flow is missing persisted ${readerSetting}`);
}

for (const relativePath of ['src/components/Settings.tsx', 'src/components/settings/AiProfilesPanel.tsx']) {
  const source = read(relativePath);
  for (const match of source.matchAll(/<ToggleSwitch\b/g)) {
    const close = source.indexOf('/>', match.index);
    const usage = source.slice(match.index, close === -1 ? match.index + 240 : close + 2);
    expect(usage.includes('label='), `${relativePath}:${source.slice(0, match.index).split('\n').length}: ToggleSwitch is missing an accessible label`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Design boundary checks passed for ${sections.length} settings sections, 5 reader themes, app-level light/dark/system themes, 15 shared boundaries, and 4 reader flow anchors.`);
}
