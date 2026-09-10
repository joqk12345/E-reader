import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const readerVersion = packageJson.version;

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.READER_UI_PORT || 1432);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const browserCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const findBrowser = async () => {
  for (const candidate of browserCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known local browser binary.
    }
  }
  throw new Error(
    'No local Chrome/Chromium executable found. Set CHROME_BIN or run `npx playwright install chromium`.'
  );
};

const waitForServer = async (timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`UI preview did not become ready at ${BASE_URL}`);
};

const mockBackendScript = `
(() => {
  const documents = [
    {
      id: 'ui-smoke-epub',
      title: 'Smoke EPUB',
      author: 'UI Fixture',
      file_path: '/tmp/smoke.epub',
      file_type: 'epub',
      created_at: 1710000000,
      updated_at: 1710000000,
    },
    {
      id: 'ui-smoke-pdf',
      title: 'Smoke PDF',
      author: 'UI Fixture',
      file_path: '/tmp/smoke.pdf',
      file_type: 'pdf',
      created_at: 1710000001,
      updated_at: 1710000001,
    },
    {
      id: 'ui-smoke-markdown',
      title: 'Smoke Markdown',
      author: 'UI Fixture',
      file_path: '/tmp/smoke.md',
      file_type: 'markdown',
      created_at: 1710000002,
      updated_at: 1710000002,
    },
  ];
  const config = {
    provider: 'lmstudio',
    lm_studio_url: 'http://127.0.0.1:1234',
    embedding_provider: 'local_transformers',
    embedding_model: 'ui-smoke',
    embedding_dimension: 384,
    embedding_auto_reindex: false,
    chat_model: 'ui-smoke-chat',
    enable_thinking: false,
    translation_mode: 'off',
    reader_background_color: '#F4F8EE',
    reader_font_size: 18,
    keymap: {},
    tts_provider: 'auto',
    edge_tts_voice: 'en-US-AriaNeural',
  };
  const sections = [{ id: 'ui-smoke-section', doc_id: 'ui-smoke-epub', title: 'Smoke chapter', order_index: 0, href: 'chapter.xhtml' }];
  const paragraphs = [{ id: 'ui-smoke-paragraph', doc_id: 'ui-smoke-epub', section_id: 'ui-smoke-section', order_index: 0, text: 'Smoke reading content.', location: 'chapter.xhtml#p0' }];

  window.localStorage.setItem('reader:auto-update-enabled', '0');
  window.localStorage.setItem('reader-app-theme', 'dark');
  window.localStorage.setItem('vmark-reader-settings', JSON.stringify({ theme: 'night' }));
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      switch (command) {
        case 'get_config': return config;
        case 'list_documents': return documents;
        case 'get_document_previews': return documents.map((doc) => ({ doc_id: doc.id, preview: doc.title }));
        case 'get_embedding_profile_status': return { indexed: 0, total: 0, stale: 0 };
        case 'list_document_tags':
        case 'list_tag_suggestions':
        case 'list_tag_facets':
        case 'list_tag_library':
        case 'list_batch_tag_review_items':
        case 'get_related_documents_by_tags':
        case 'list_annotations':
        case 'list_tts_voices': return [];
        case 'get_document_sections': return sections;
        case 'get_section_paragraphs': return paragraphs;
        case 'get_document_paragraphs': return paragraphs;
        case 'get_document_source_url': return null;
        case 'publication_get_blocks_v2': {
          const documentId = args?.request?.documentId || 'ui-smoke-epub';
          const offset = args?.request?.offset || 0;
          const limit = args?.request?.limit || 100;
          return {
            schemaVersion: 1,
            publicationId: 'ui-smoke-publication',
            documentId,
            sourceHash: '0000000000000000000000000000000000000000000000000000000000000000',
            offset,
            limit,
            total: 0,
            hasMore: false,
            blocks: [],
          };
        }
        case 'get_update_target': return { os: 'macos', arch: 'aarch64' };
        case 'plugin:app|version': return readerVersion;
        default: return null;
      }
    },
    event: {
      listen: async () => 0,
      unlisten: async () => undefined,
    },
  };
})();
`;

const countExactlyOne = async (locator, label) => {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
};

const expectVisible = async (locator, label) => {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await locator.isVisible())) throw new Error(`${label}: expected visible`);
};

const main = async () => {
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, executablePath: await findBrowser() });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => console.error(`Page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`Browser console error: ${message.text()}`);
    });
    await page.addInitScript({ content: mockBackendScript });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await expectVisible(page.getByTestId('library-page'), 'Library page');
    const cards = page.getByTestId('document-card');
    if ((await cards.count()) !== 3) throw new Error(`Library cards: expected 3, got ${await cards.count()}`);

    const epubFilter = page.getByTestId('format-filter-epub');
    await countExactlyOne(epubFilter, 'EPUB filter');
    await epubFilter.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="format-filter-epub"]')?.getAttribute('aria-pressed') === 'true');
    if ((await epubFilter.getAttribute('aria-pressed')) !== 'true') throw new Error('EPUB filter did not become active');
    if ((await cards.count()) !== 1) throw new Error(`EPUB filter cards: expected 1, got ${await cards.count()}`);

    const search = page.getByTestId('library-search-input');
    await countExactlyOne(search, 'Library search');
    await search.fill('Smoke EPUB');
    if ((await cards.count()) !== 1) throw new Error('Collection search removed the matching EPUB unexpectedly');
    await search.fill('no such document');
    if ((await cards.count()) !== 0) throw new Error('Collection search did not remove non-matching documents');
    await search.fill('');

    const allFilter = page.getByTestId('format-filter-all');
    await countExactlyOne(allFilter, 'All filter');
    await allFilter.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="format-filter-all"]')?.getAttribute('aria-pressed') === 'true');
    if ((await cards.count()) !== 3) throw new Error('All filter did not restore all documents');

    const preferences = page.getByTestId('preferences-button');
    await countExactlyOne(preferences, 'Preferences button');
    await preferences.click();
    await expectVisible(page.getByTestId('settings-dialog'), 'Settings dialog');
    await page.getByTestId('settings-close-button').click();
    await page.getByTestId('settings-dialog').waitFor({ state: 'hidden', timeout: 5_000 });

    const importButton = page.getByTestId('library-import-button');
    await importButton.click();
    await expectVisible(page.getByTestId('import-dialog'), 'Import dialog');
    const importDialog = page.getByTestId('import-dialog');
    await importDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await importDialog.waitFor({ state: 'hidden', timeout: 5_000 });

    const epubCard = page.locator('[data-testid="document-card"][data-document-id="ui-smoke-epub"]');
    await countExactlyOne(epubCard, 'EPUB document card');
    await page.evaluate(() => {
      window.localStorage.setItem('reader-app-theme', 'dark');
      window.localStorage.setItem('vmark-reader-settings', JSON.stringify({ theme: 'night' }));
    });
    await page.setViewportSize({ width: 1024, height: 900 });
    await epubCard.click();
    try {
      await expectVisible(page.getByTestId('reader-page'), 'Reader page after opening document');
      const expandTools = page.getByRole('button', { name: 'Expand tools', exact: true });
      await expectVisible(expandTools, 'Collapsed tool rail');
      await expectVisible(page.getByTitle('Smoke EPUB'), 'Reader document title');
      await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'dark');
      await expectVisible(page.locator('[data-reader-theme="night"]'), 'Night reading theme');
      await expandTools.click();
      await expectVisible(page.getByRole('button', { name: 'Collapse tools', exact: true }), 'Expanded tool workspace');
      await expectVisible(page.getByRole('button', { name: 'Expand sidebar', exact: true }), 'Collapsed TOC after opening tools');
    } catch (error) {
      await page.screenshot({ path: '/private/tmp/reader-ui-smoke-open-failure.png', fullPage: false });
      throw error;
    }
    await page.getByTestId('reader-back-button').click();
    await expectVisible(page.getByTestId('library-page'), 'Library after returning from Reader');

    console.log('UI smoke passed: Library load, format filter, collection search, Preferences, import dialog, document open, and return flow.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
};

main().catch((error) => {
  console.error(`UI smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
