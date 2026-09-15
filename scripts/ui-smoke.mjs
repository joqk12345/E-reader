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
    embedding_provider: 'lmstudio',
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
  const markdownSections = [{ id: 'ui-smoke-markdown-section', doc_id: 'ui-smoke-markdown', title: 'Typography', order_index: 0, href: 'smoke.md' }];
  const markdownParagraphs = [
    { id: 'ui-smoke-markdown-heading', doc_id: 'ui-smoke-markdown', section_id: 'ui-smoke-markdown-section', order_index: 0, text: '# Typography heading', location: 'smoke.md#h1' },
    { id: 'ui-smoke-markdown-body', doc_id: 'ui-smoke-markdown', section_id: 'ui-smoke-markdown-section', order_index: 1, text: 'Reading body copy.', location: 'smoke.md#p0' },
    ...[2, 3, 4, 5, 6].map((level) => ({ id: 'ui-smoke-markdown-heading-' + level, doc_id: 'ui-smoke-markdown', section_id: 'ui-smoke-markdown-section', order_index: level, text: '#'.repeat(level) + ' Level ' + level, location: 'smoke.md#h' + level })),
    { id: 'ui-smoke-markdown-quote', doc_id: 'ui-smoke-markdown', section_id: 'ui-smoke-markdown-section', order_index: 7, text: '> A reading quote.', location: 'smoke.md#quote' },
    { id: 'ui-smoke-markdown-code', doc_id: 'ui-smoke-markdown', section_id: 'ui-smoke-markdown-section', order_index: 8, text: String.fromCharCode(96).repeat(3) + 'js' + String.fromCharCode(10) + 'const answer = 42;' + String.fromCharCode(10) + String.fromCharCode(96).repeat(3), location: 'smoke.md#code' },
  ];

  window.localStorage.setItem('reader:auto-update-enabled', '0');
  window.localStorage.setItem('reader-app-theme', 'dark');
  window.localStorage.setItem('vmark-reader-settings', JSON.stringify({ theme: 'night' }));
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      switch (command) {
        case 'get_config': return config;
        case 'get_ai_profiles': return { providers: [], models: [], agents: [] };
        case 'list_documents': return documents;
        case 'get_document_previews': return documents.map((doc) => ({ doc_id: doc.id, preview: doc.title }));
        case 'get_embedding_profile_status': return { indexed: 0, total: 0, stale: 0, profile: { provider: 'local_transformers', model: 'ui-smoke', dimension: 384 } };
        case 'search': return [{ paragraph_id: 'ui-smoke-paragraph', snippet: 'Alignment creates a clear visual relationship between elements.', score: 0.92, location: 'Smoke chapter' }];
        case 'get_paragraph_context': return { paragraph_id: 'ui-smoke-paragraph', doc_id: 'ui-smoke-epub', section_id: 'ui-smoke-section' };
        case 'list_document_tags':
        case 'list_tag_suggestions':
        case 'list_tag_facets':
        case 'list_tag_library':
        case 'list_batch_tag_review_items':
        case 'get_related_documents_by_tags':
        case 'list_annotations':
        case 'list_tts_voices': return [];
        case 'get_document_sections': return args?.docId === 'ui-smoke-markdown' ? markdownSections : sections;
        case 'get_section_paragraphs': return args?.sectionId === 'ui-smoke-markdown-section' ? markdownParagraphs : paragraphs;
        case 'get_document_paragraphs': return args?.docId === 'ui-smoke-markdown' ? markdownParagraphs : paragraphs;
        case 'get_document_source_url': return args?.docId === 'ui-smoke-markdown' ? 'https://example.com/smoke' : null;
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
    env: { ...process.env, VITE_EPUB_ENGINE: 'foliate' },
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
    await expectVisible(page.getByTestId('workspace-page-title'), 'Workspace page title');
    await expectVisible(page.getByTestId('app-library-identity'), 'App Library identity');
    await expectVisible(page.getByTestId('app-library-display-options-button'), 'App Library display options');
    if (await page.getByTestId('display-options-button').count() !== 0) throw new Error('Display options should not remain in page content');
    if (await page.locator('.library-top-toolbar').count() !== 0) throw new Error('The obsolete Library toolbar should not leave an empty bordered row');
    if (await page.getByTestId('library-top-identity').count() !== 0) throw new Error('Library identity should not be repeated in page content');
    if (await page.getByRole('tablist', { name: 'Workspace' }).count() !== 0) throw new Error('Workspace should not use a second tab bar in the top shell');
    const librarySidebarSearch = page.getByTestId('library-sidebar-search');
    await expectVisible(librarySidebarSearch, 'Library sidebar search');
    if (await page.getByTestId('library-top-search').count() !== 0) throw new Error('Library search should not remain in the main toolbar');
    const libraryDocumentList = page.getByTestId('library-document-list');
    const libraryPadding = await libraryDocumentList.evaluate((element) => getComputedStyle(element).paddingLeft);
    if (libraryPadding !== '16px') throw new Error(`Library content padding should be 16px, got ${libraryPadding}`);
    if (await page.getByText('Your reading desk', { exact: true }).count() !== 0) throw new Error('Global header should not repeat the reading desk subtitle');
    if (await page.getByText('Your collection', { exact: true }).count() !== 0) throw new Error('Library should not repeat the collection subtitle');
    const cards = page.getByTestId('document-card');
    if ((await cards.count()) !== 3) throw new Error(`Library cards: expected 3, got ${await cards.count()}`);
    await expectVisible(page.getByTestId('continue-reading'), 'Continue reading section');
    await expectVisible(page.getByTestId('app-library-import-button'), 'Primary import action');
    if (await page.getByTestId('batch-tags-button').count() !== 0) throw new Error('Batch Tags should be progressively disclosed');
    if (await page.getByTestId('tag-library-button').count() !== 0) throw new Error('Tag Library should be progressively disclosed');
    const libraryMore = page.getByTestId('app-library-more-actions-button');
    await countExactlyOne(libraryMore, 'Library more actions button');
    if ((await libraryMore.getAttribute('aria-expanded')) !== 'false') throw new Error('Library More should start collapsed');
    await libraryMore.click();
    const moreMenu = page.getByTestId('library-more-actions-menu');
    await expectVisible(moreMenu, 'Library More menu');
    if ((await libraryMore.getAttribute('aria-expanded')) !== 'true') throw new Error('Library More should expose its expanded state');
    const [moreButtonBox, moreMenuBox] = await Promise.all([libraryMore.boundingBox(), moreMenu.boundingBox()]);
    if (!moreButtonBox || !moreMenuBox) throw new Error('Library More geometry was unavailable');
    if (moreMenuBox.y < moreButtonBox.y + moreButtonBox.height) throw new Error('Library More menu should open below its App Shell trigger');
    if (Math.abs(moreMenuBox.x + moreMenuBox.width - (moreButtonBox.x + moreButtonBox.width)) > 2) throw new Error('Library More menu should be right-aligned with its App Shell trigger');
    await expectVisible(page.getByTestId('batch-tags-button'), 'Batch Tags menu action');
    await expectVisible(page.getByTestId('tag-library-button'), 'Tag Library menu action');
    if (!(await cards.first().getAttribute('class'))?.includes('document-card-list')) throw new Error('Library should default to List view');
    if (await page.getByTestId('library-category-group').count() !== 0) throw new Error('Library should be flat by default');

    const displayOptions = page.getByTestId('app-library-display-options-button');
    if ((await displayOptions.getAttribute('aria-expanded')) !== 'false') throw new Error('Display options should start collapsed');
    await displayOptions.click();
    const displayMenu = page.getByTestId('library-display-options-menu');
    await expectVisible(displayMenu, 'Display options menu');
    if ((await displayOptions.getAttribute('aria-expanded')) !== 'true') throw new Error('Display options should expose its expanded state');
    if (await moreMenu.isVisible()) throw new Error('Display options and More menus should be mutually exclusive');
    const [displayButtonBox, displayMenuBox] = await Promise.all([displayOptions.boundingBox(), displayMenu.boundingBox()]);
    if (!displayButtonBox || !displayMenuBox) throw new Error('Display options geometry was unavailable');
    if (displayMenuBox.y < displayButtonBox.y + displayButtonBox.height) throw new Error('Display options menu should open below its App Shell trigger');
    if (Math.abs(displayMenuBox.x + displayMenuBox.width - (displayButtonBox.x + displayButtonBox.width)) > 2) throw new Error('Display options menu should be right-aligned with its App Shell trigger');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    if (!(await displayMenu.getByRole('menuitem').first().evaluate((element) => element === document.activeElement))) throw new Error('Display options should focus its first menu item when opened');
    await page.keyboard.press('Escape');
    if (await displayMenu.isVisible()) throw new Error('Escape should close Display options');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'app-library-display-options-button');
    await displayOptions.click();
    await displayOptions.click();
    if (await displayMenu.isVisible()) throw new Error('Display options trigger should close its open menu');
    await displayOptions.click();
    await page.getByRole('menuitem', { name: 'Compact', exact: true }).click();
    if (!(await cards.first().getAttribute('class'))?.includes('document-card-compact')) throw new Error('Compact view did not apply');
    await displayOptions.click();
    await page.getByRole('menuitem', { name: 'Grid', exact: true }).click();
    if (!(await cards.first().getAttribute('class'))?.includes('document-card-grid')) throw new Error('Grid view did not apply');

    const displayOptionsForGrouping = page.getByTestId('app-library-display-options-button');
    await displayOptionsForGrouping.click();
    const groupByCategory = page.getByRole('menuitem', { name: 'Group by category', exact: true });
    await countExactlyOne(groupByCategory, 'Group by category option');
    await groupByCategory.click();
    await expectVisible(page.getByTestId('library-category-group'), 'Opt-in category grouping');
    await displayOptions.click();
    await expectVisible(displayMenu, 'Display options before resize');
    await page.setViewportSize({ width: 1024, height: 900 });
    await displayMenu.waitFor({ state: 'hidden' });
    if ((await displayOptions.getAttribute('aria-expanded')) !== 'false') throw new Error('Resize should synchronize the collapsed Display options state');
    await page.setViewportSize({ width: 1440, height: 900 });

    const moreFilters = page.getByTestId('library-more-filters-button');
    await countExactlyOne(moreFilters, 'More filters button');
    const categoryFilters = page.getByTestId('library-category-filters');
    const tagFilters = page.getByTestId('library-tag-filters');
    await countExactlyOne(categoryFilters, 'Library category filters');
    await countExactlyOne(tagFilters, 'Library tag filters');
    if (!(await categoryFilters.getAttribute('data-surface'))) throw new Error('Category filters are missing a surface contract');
    if (!(await tagFilters.getAttribute('data-surface'))) throw new Error('Tag filters are missing a surface contract');
    if (await categoryFilters.isVisible()) throw new Error('Category filters should be progressively disclosed');
    if (await tagFilters.isVisible()) throw new Error('Tag filters should be progressively disclosed');
    await moreFilters.click();
    await expectVisible(categoryFilters, 'Expanded category filters');
    await expectVisible(tagFilters, 'Expanded tag filters');

    const epubFilter = page.getByTestId('format-filter-epub');
    await countExactlyOne(epubFilter, 'EPUB filter');
    await epubFilter.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="format-filter-epub"]')?.getAttribute('aria-pressed') === 'true');
    if ((await epubFilter.getAttribute('aria-pressed')) !== 'true') throw new Error('EPUB filter did not become active');
    if ((await cards.count()) !== 1) throw new Error(`EPUB filter cards: expected 1, got ${await cards.count()}`);

    const search = librarySidebarSearch;
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
    await page.getByRole('button', { name: 'AI & Embedding', exact: true }).click();
    const aiMainHeading = page.getByTestId('settings-dialog').locator('main').getByText('AI & Embedding', { exact: true });
    if (await aiMainHeading.count() !== 1) throw new Error('AI settings should have one main heading');
    await expectVisible(page.getByTestId('ai-save-scope-note'), 'AI save scope note');
    await expectVisible(page.getByTestId('ai-effective-setup'), 'AI effective setup');
    if (await page.getByTestId('ai-effective-setup').getAttribute('open') !== null) throw new Error('AI effective setup should be collapsed by default');
    await page.getByTestId('settings-close-button').click();
    await page.getByTestId('settings-dialog').waitFor({ state: 'hidden', timeout: 5_000 });

    const importButton = page.getByTestId('app-library-import-button');
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
      await expectVisible(page.getByTestId('foliate-epub-reader'), 'Default foliate EPUB reader');
      if (await page.getByTestId('reader-page').count() !== 0) throw new Error('EPUB should not use the legacy paragraph renderer by default');
      const foliateReader = page.getByTestId('foliate-epub-reader');
      const foliateHeader = foliateReader.locator('header');
      const foliateHeaderHeight = await foliateHeader.evaluate((element) => element.getBoundingClientRect().height);
      if (foliateHeaderHeight > 52) throw new Error(`Foliate EPUB header is too tall: ${foliateHeaderHeight}px`);
      if (await foliateReader.evaluate((element) => element.scrollWidth > element.clientWidth)) throw new Error('Foliate EPUB reader should not overflow at 1024px');
      await expectVisible(foliateReader.getByRole('button', { name: 'Previous page', exact: true }), 'Foliate previous page');
      await expectVisible(foliateReader.getByRole('button', { name: 'Next page', exact: true }), 'Foliate next page');
      await expectVisible(foliateReader.getByRole('button', { name: 'Scroll', exact: true }), 'Foliate scroll mode');
      const readerSettings = foliateReader.getByRole('button', { name: 'Reader settings', exact: true });
      await expectVisible(readerSettings, 'Foliate reader settings trigger');
      await readerSettings.click();
      await expectVisible(foliateReader.getByLabel('Reading theme', { exact: true }), 'Foliate theme setting');
      await expectVisible(foliateReader.getByLabel('Text size', { exact: true }), 'Foliate text size setting');
      await expectVisible(foliateReader.getByLabel('Line height', { exact: true }), 'Foliate line height setting');
      await expectVisible(foliateReader.getByLabel('Text width', { exact: true }), 'Foliate text width setting');
      await expectVisible(foliateReader.getByText('Contents', { exact: true }), 'Foliate contents');
      const contentsToggle = foliateReader.getByRole('button', { name: 'Collapse contents', exact: true });
      await expectVisible(contentsToggle, 'Foliate contents collapse button');
      await contentsToggle.click();
      if (await foliateReader.getByText('Contents', { exact: true }).isVisible()) throw new Error('Foliate contents should collapse');
      const contentsExpand = foliateReader.getByRole('button', { name: 'Expand contents', exact: true });
      await expectVisible(contentsExpand, 'Foliate contents expand button');
      await contentsExpand.click();
      await expectVisible(foliateReader.getByText('Contents', { exact: true }), 'Expanded Foliate contents');
      if (await foliateReader.getByText(/&#13;/).count() !== 0) throw new Error('Foliate EPUB output should not expose raw carriage-return entities');
      if (await page.getByTestId('reader-page').count() !== 0) {
      const readerHeader = page.locator('[data-testid="reader-page"] > header');
      const readerHeaderHeight = await readerHeader.evaluate((element) => element.getBoundingClientRect().height);
      if (readerHeaderHeight > 52) throw new Error(`Reader header is too tall: ${readerHeaderHeight}px`);
      const readerOverflow = await page.getByTestId('reader-page').evaluate((element) => element.scrollWidth > element.clientWidth);
      if (readerOverflow) throw new Error('Reader should not introduce horizontal overflow at 1024px');
      const readerViewTrigger = page.getByRole('button', { name: 'View', exact: true });
      await expectVisible(readerViewTrigger, 'Reader View menu trigger');
      if ((await readerViewTrigger.getAttribute('aria-expanded')) !== 'false') throw new Error('Reader View should start collapsed');
      await readerViewTrigger.click();
      const readerViewMenu = page.getByRole('menu', { name: 'Reader view', exact: true });
      await expectVisible(readerViewMenu, 'Reader View menu');
      if ((await readerViewTrigger.getAttribute('aria-expanded')) !== 'true') throw new Error('Reader View should expose its expanded state');
      await expectVisible(readerViewMenu.getByRole('menuitem', { name: /^Translation (Off|EN→ZH|ZH→EN)$/ }), 'Translation in Reader View');
      await expectVisible(readerViewMenu.getByText(/Paragraphs \d+/), 'Paragraph count in Reader View statistics');
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
      const viewMenuItems = readerViewMenu.getByRole('menuitem');
      if (!(await viewMenuItems.first().evaluate((element) => element === document.activeElement))) throw new Error('Reader View should focus its first menu item');
      await page.keyboard.press('ArrowDown');
      if (!(await viewMenuItems.nth(1).evaluate((element) => element === document.activeElement))) throw new Error('ArrowDown should move Reader View focus');
      await page.keyboard.press('ArrowUp');
      if (!(await viewMenuItems.first().evaluate((element) => element === document.activeElement))) throw new Error('ArrowUp should move Reader View focus');
      const readerBack = page.getByTestId('reader-back-button');
      await readerBack.focus();
      await page.keyboard.press('ArrowDown');
      if (!(await readerBack.evaluate((element) => element === document.activeElement))) throw new Error('Reader menu keyboard handling should not capture arrows outside the menu');
      await viewMenuItems.first().focus();
      await page.keyboard.press('Escape');
      if (await readerViewMenu.isVisible()) throw new Error('Escape should close Reader View');
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'View');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('reader:toggle-view-menu')));
      await page.waitForFunction(() => document.querySelector('#reader-view-trigger')?.getAttribute('aria-expanded') === 'true');
      await page.keyboard.press('Escape');
      if (await readerHeader.getByText(/Translation:/).count() !== 0) throw new Error('Translation state should be progressively disclosed in View');
      if (await readerHeader.locator('img[alt="Reader Logo"]').count() !== 0) throw new Error('Reader chrome should not repeat the product logo beside the document title');
      const headerTools = readerHeader.getByRole('button', { name: 'Tools', exact: true });
      await expectVisible(headerTools, 'Reader Tools trigger');
      if ((await headerTools.getAttribute('aria-expanded')) !== 'false') throw new Error('Reader Tools should start collapsed');
      if (await page.getByText(/Word Stats:/).count() !== 0) throw new Error('Word statistics should not occupy a persistent Reader footer');
      const tocPanel = page.getByTestId('reader-toc-panel');
      await expectVisible(tocPanel, 'Reader TOC panel');
      const expandTools = page.getByRole('button', { name: 'Expand tools', exact: true });
      await expectVisible(expandTools, 'Collapsed tool rail');
      await expectVisible(page.getByTitle('Smoke EPUB'), 'Reader document title');
      await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'dark');
      await expectVisible(page.locator('[data-reader-theme="night"]'), 'Night reading theme');
      await headerTools.click();
      if ((await headerTools.getAttribute('aria-expanded')) !== 'true') throw new Error('Reader Tools trigger should expose its expanded state');
      await expectVisible(page.getByRole('button', { name: 'Collapse tools', exact: true }), 'Expanded tool workspace');
      const expandToc = page.getByRole('button', { name: 'Expand sidebar', exact: true });
      await expectVisible(expandToc, 'Collapsed TOC after opening tools');
      if ((await tocPanel.getAttribute('aria-label')) !== 'Table of contents') throw new Error('TOC panel should retain an accessible identity when collapsed');
      if ((await expandToc.getAttribute('aria-expanded')) !== 'false') throw new Error('Collapsed TOC trigger should expose its state');
      if (await expandToc.getAttribute('aria-controls')) throw new Error('Collapsed TOC should not reference an unrendered navigation target');
      if ((await tocPanel.getByRole('button').count()) !== 1) throw new Error('Collapsed TOC should expose only its expansion control');
      await expectVisible(page.getByTestId('reader-tool-group-primary'), 'Primary Reader tool group');
      for (const label of ['Search', 'Understand', 'Chat']) {
        await expectVisible(page.getByRole('tab', { name: label, exact: true }), `Primary ${label} tool`);
      }
      const moreTools = page.getByTestId('reader-more-tools-button');
      await countExactlyOne(moreTools, 'More tools button');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('reader:open-annotations')));
      await page.waitForFunction(() => document.querySelector('[data-testid="reader-more-tools-button"]')?.getAttribute('aria-expanded') === 'true');
      await expectVisible(page.getByRole('tab', { name: 'Marks', exact: true }), 'Event-opened advanced tool identity');
      await moreTools.click();
      await expectVisible(page.getByRole('tab', { name: 'Search', exact: true }), 'Primary tool after closing advanced tools');
      if (await page.getByRole('tab', { name: 'Marks', exact: true }).isVisible()) throw new Error('Closing More tools should not hide the active advanced tool identity');
      for (const label of ['Summary', 'Notes', 'Translate', 'Dict', 'Audio']) {
        if (await page.getByRole('tab', { name: label, exact: true }).isVisible()) throw new Error(`${label} should be progressively disclosed`);
      }
      await moreTools.click();
      await expectVisible(page.getByRole('tab', { name: 'Summary', exact: true }), 'Expanded Summary tool');
      await expectVisible(page.getByRole('tab', { name: 'Notes', exact: true }), 'Expanded Notes tool');
      }
    } catch (error) {
      await page.screenshot({ path: '/private/tmp/reader-ui-smoke-open-failure.png', fullPage: false });
      throw error;
    }
    await page.getByRole('button', { name: '← Library', exact: true }).click();
    await expectVisible(page.getByTestId('library-page'), 'Library after returning from Reader');

    const markdownCard = page.locator('[data-testid="document-card"][data-document-id="ui-smoke-markdown"]');
    await markdownCard.click();
    await expectVisible(page.getByTestId('unsupported-document'), 'Historical Markdown unsupported state');
    await expectVisible(page.getByText('Markdown is no longer supported'), 'Historical Markdown message');
    await page.getByTestId('unsupported-document-back').click();
    await expectVisible(page.getByTestId('library-page'), 'Library after historical Markdown verification');

    const workspaceSelect = page.getByTestId('workspace-select');
    await workspaceSelect.click();
    await page.getByRole('menuitem', { name: 'Semantic Search', exact: true }).click();
    await expectVisible(page.getByTestId('semantic-search-page'), 'Semantic Search page');
    const semanticQuery = page.getByPlaceholder('Enter your search query...');
    await semanticQuery.fill('how does alignment help?');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expectVisible(page.getByTestId('semantic-search-result'), 'Semantic search result');
    await expectVisible(page.getByRole('button', { name: 'Open original', exact: true }), 'Open original action');

    console.log('UI smoke passed: Library load, format filter, collection search, Preferences, import dialog, document open, semantic search, and return flow.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
};

main().catch((error) => {
  console.error(`UI smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
