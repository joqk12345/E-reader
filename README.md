# Reader

<div align="center">
  <h3>📚 Local-first EPUB Reader with AI-Powered Features</h3>
  <p>Built with Tauri 2 + React, focused on offline reading, semantic search, summarization, translation, and bilingual mode.</p>
</div>

## 🌐 Project Website

- Live website: https://joqk12345.github.io/E-reader/
- Repository: https://github.com/joqk12345/E-reader.git
- Website source is in `website/` (VitePress)
- Local dev:
  - `npm run website:dev`
- Local build:
  - `npm run website:build`
- GitHub Pages deployment:
  - Workflow file: `.github/workflows/website.yml`
  - Trigger: push to `main` with changes under `website/**` (or manual run)

## ✨ Features

## 🆕 Recent Updates (2026-02)

- **Link import quick actions in Reader header (2026-02-26)**:
  - when a document is imported from a URL (with detectable source link), Reader now shows a top-right quick actions button
  - dropdown actions include:
    - `Copy Link`
    - `Open in DefaultBrowser`
  - actions are hidden for non-link imports

- **Selection share upgrade (2026-02-25)**:
  - selection popover now includes a `Share to X` action
  - shared post content now includes selected quote + source context (`title`, optional `author`)
  - adds content index metadata when available (`Section x/y`, PDF `Page n`)
  - appends a short Reader introduction and intro/index link: `https://joqk12345.github.io/E-reader/`

- **Markdown list rendering fix (2026-02-25)**:
  - fixed a reader normalization edge case where lines with leading spaces could be mistaken for tree-structure blocks and wrapped as code
  - Markdown list items like `- Write everything you **don't want** in life (anti-vision)` now render correctly instead of showing as unrendered/plain text

- **Updater UX refresh (2026-02-25)**:
  - `Settings > About` now includes a dedicated updates workflow:
    - `Automatic updates` toggle (`Check for updates on startup`)
    - manual `Check for updates` action with live status
    - `Update Available` card with `Download` and `Skip`
  - updater now resolves platform/arch specific installer assets from GitHub Releases (macOS/Windows/Linux) and opens the best matching download URL.
  - automatic checks are cached to reduce repeated API calls.
  - About tab typography was normalized to match other settings tabs (`Shortcuts`, `Integrations`), and the `Open Releases` button size was reduced for visual consistency.

- **Settings + selection popover polish (2026-02-24)**:
  - `Settings > AI & Embedding` now exposes a dedicated `Chat Model` field (no hardcoded model name in settings UI).
  - selection action popover now clamps to viewport width using real popover width, so right-edge selections no longer clip out of screen.
  - `Settings > Appearance` now separates editor-related typography controls into a standalone `Editor` entry (`Typography` panel).
  - sidebar settings icon alignment normalized with fixed icon slot sizing.

- **About links update (2026-02-17)**:
  - Settings > About now has dedicated `Website` and `GitHub` entries
  - link items are shown as icon + label rows with hover color transition
  - external links are opened via system browser (with fallback behavior)

- **External link open behavior fix (2026-02-17)**:
  - Markdown links in Reader now open in external browser when clicked
  - covers both source markdown rendering and translated markdown rendering
  - added Tauri shell open permission + plugin wiring with runtime fallback logic

- **Library / Branding / macOS menu polish (2026-02-16)**:
  - Library homepage controls simplified with a cleaner macOS-style layout:
    - single top toolbar + compact display options menu (`Grid/List/Compact`, sort, type filter, category, grouping)
    - left sidebar kept as lightweight quick filters
  - Library sidebar resize restored:
    - drag-to-resize behavior is back with visual resize handle
  - Import flow streamlined:
    - unified `Import` dialog for local files (`EPUB/PDF/Markdown`)
    - URL import kept as `Beta` inside the same dialog
    - dialog auto-closes after successful import
  - Reader naming unified to `Reader` in visible product surfaces
  - Brand logo rollout:
    - app icon assets regenerated from `public/reader-logo.svg` for Tauri bundle targets
    - logo added to Library header, Reader header title area, and Settings > About
  - macOS app menu polish:
    - `About` now jumps to Settings `About` tab
    - app menu labels refined with branded symbol text and spacing

- **Reader UX + Layout refresh (2026-02-15)**:
  - Reading appearance settings now include:
    - `Column Layout`: `Single Column` / `Two Columns`
    - `Bilingual View`: `Source + Translation` / `Source Only` / `Translation Only`
  - Reader top toolbar now uses a compact `Reading View` dropdown instead of flat button rows.
  - `Annotations & Highlights` moved into right `ToolPanel` as a dedicated `Marks` tab.
  - new `Dict` tab in right `ToolPanel`:
    - selection toolbar adds `Dict` and `Sentence` actions
    - `Dict`: context-aware meaning, IPA display, pronunciation via configured TTS engine, sentence translation
    - `Sentence`: sentence-structure analysis with markdown-marked components + Chinese translation
  - selection toolbar simplified:
    - removed duplicate `Translate` quick action (translation remains in right `Translate` tab)
  - Reader bottom stats bar updated:
    - style aligned with library status bar
    - confined to center reading pane (does not occupy left/right sidebars)
    - hidden automatically in focused reading mode
    - English copy + word-count based stats: `Word Stats: Source / Translation / Paragraphs`
    - in two-column mode, status bar now also shows pagination: `Page current/total`
  - Two-column pagination behavior refinement:
    - no longer applies flow-columns across full content at once
    - now paginates by current reading window and supports keyboard page flip
    - removed floating pagination overlay to avoid text occlusion
  - Markdown code block rendering:
    - added syntax highlighting in reader mode for fenced code blocks
  - Markdown rendering robustness:
    - fixed fenced code block paragraph splitting in markdown parser (prevents broken/partial tree-structure rendering)
    - improved tree-structure text rendering fallback in reader/dict markdown display

- **Library Sidebar + Runtime Status Bar (new)**:
  - left sidebar now supports `All / Markdown / PDF / EPUB` grouped filtering with linked search counts
  - sidebar is resizable by drag, and can be collapsed/expanded (default expanded)
  - compact visual style for denser browsing layout
  - bottom runtime status bar (content area only) shows:
    - Chat model / status / local-or-http mode
    - Embedding model / status / local-or-http mode
    - embedding index count (`indexed/total`)
    - TTS provider/voice / status / local-or-http mode (Edge TTS marked as remote/http)
- **Reader Theme System (new)**:
  - 5 built-in reading themes: `White`, `Paper` (default), `Mint`, `Sepia`, `Night`
  - customizable font size (12-30px), line height (1.2-2.4), content width (36-120em)
  - improved widescreen behavior:
    - single-column can expand much wider on large monitors
    - two-column page size now adapts to viewport size to avoid half-filled dual-page screens
  - CJK letter spacing option for better Chinese/Japanese/Korean readability
  - theme preferences persisted in local storage
- **Focused Reading Mode (improved)**:
  - one-click collapse of header tools + TOC + right tool panel for distraction-free reading
  - exits reading mode by restoring the previous collapse/expand state
  - supports shortcut toggle (`Cmd/Ctrl+Shift+R`)
- **Shortcut system expanded and configurable**:
  - added configurable shortcuts: `Open Search`, `Audio Play`, `Audio Pause/Resume`, `Audio Stop`, `Toggle Reading Mode`, `Toggle Header Tools`, `Toggle Window Maximize`, `Font Increase/Decrease/Reset`
  - defaults now include:
    - `Cmd/Ctrl+F` for search
    - `Cmd/Ctrl+Shift+P` play, `Cmd/Ctrl+Shift+Space` pause/resume, `Cmd/Ctrl+Shift+S` stop
    - `Cmd/Ctrl+=` / `Cmd/Ctrl+-` / `Cmd/Ctrl+0` for font size
    - `PageDown/Space/J` / `PageUp/Shift+Space/K` for navigation
  - all above bindings are editable in Settings and persisted in keymap config
- **Selection action toolbar redesigned**:
  - selecting text now opens a movable/resizable action popover near selection anchor
  - actions include: `Ask`, `Play from here`, `Explain`, `Dict`, `Sentence`, `Copy`, `Share to X`, `Highlight`, `Note`
  - action order can be drag-sorted and is persisted in local storage
  - `Play from here` now has explicit confirmation dialog before TTS starts
- **TTS sentence-follow accuracy improvements (Markdown)**:
  - TTS sentence queue and UI sentence matching now use the same markdown-to-speakable normalization path
  - sentence key parsing is hardened for paragraph ids containing underscores
  - markdown reading highlight now uses DOM-range marking (`mark[data-reading-sentence]`) for better cross-node matching (including links)
- **Selection-to-tool workflow upgrades**:
  - `Ask` sends question to Chat tab directly from selection popover
  - `Translate` switches to Translate tab and can auto-run on selected text
  - `Note` supports saving both selected quote and optional note content into Notes tab
  - `Cmd/Ctrl+F` now opens Search tab and auto-focuses the query input
- **Tool panel behavior improvements**:
  - Search/Summary/Translate/Deep/Chat/Notes tabs are kept mounted (hidden instead of unmounted) to reduce context loss on tab switch
  - right tool panel collapsed state now has a dedicated top-centered expand arrow (aligned with TOC behavior)
  - Chat panel supports direct free-form questions via built-in input (Enter to send), while keeping selection-triggered questions
- **TOC collapsed-state UX polish**:
  - collapsed TOC sidebar now uses a dedicated centered expand button
  - TOC content area is now independently scrollable in both expanded and collapsed layouts
- **PDF parsed-flow component (preparation)**:
  - added `PdfParsedFlow` component for page-grouped parsed rendering with figure/table/formula heuristics and page-visual fallback hooks

- **Deep Analysis tool (new `Deep` tab in Reader)**:
  - one-click structured analysis pipeline for document/section/paragraph
  - output includes: bilingual concepts, definitions, concept relations, COT-style logic, facts vs opinions, FAQ, analogies, top quotes
  - visualization-ready output with multiple Mermaid graphs
- **macOS menu shortcuts expanded**:
  - added menu actions for `Open Settings`, `Toggle Maximize Window`, `Toggle Header Toolbar`, `Next/Previous Page`
  - menu actions are emitted to Reader and executed as native app actions
- **Configurable keymap support**:
  - shortcut mappings now support persisted config (`next_page`, `prev_page`, `open_settings`)
  - shortcut matcher supports alias normalization (e.g. `PageDown/Next`, `PageUp/Prior`)
- **Reader header toolbar UX**:
  - header tools can be collapsed
  - when window is maximized, header vertical padding is reduced (`py-0`) for denser reading area
- **PDF parsing quality improvements**:
  - better handling for split words and hyphenated line wraps
  - improved normalization for spaced-uppercase heading artifacts in technical PDFs
- **Library auto organization (new)**:
  - auto category + tag inference from title and extracted content preview
  - category filter and grouped/ungrouped view toggle
  - grouped mode supports per-category collapse/expand and `Show more / Show less`
  - card layouts (`Grid`/`List`/`Compact`) tuned to denser spacing with long-title clamping
- **Context Chat + Notes workflow (new)**:
  - right tool panel adds `Chat` and `Notes` tabs
  - `Chat` supports multi-turn QA grounded in current reading scope (paragraph/section/document)
  - text selection popover now includes quick actions: `Explain` and `Take Notes`
  - `Explain` jumps to `Chat` and asks for contextual explanation automatically
  - `Take Notes` writes selected text into `Notes` workspace for centralized management
  - `Notes` supports per-document note editing, delete, JSON import/export, and Markdown export (copy)

## 🧭 Backlog Notes

- **Vector store scalability track (deferred)**:
  - keep current SQLite vector path for now
  - when corpus scale grows, evaluate LanceDB as a parallel vector index backend (A/B with current implementation)
  - migration decision gate: retrieval quality, P95 latency, indexing throughput, memory footprint, and packaging stability on desktop

- **Search robustness + relevance**:
  - client-side timeout for semantic/keyword search requests (avoid endless loading)
  - server-side embedding timeout with automatic fallback
  - semantic results now use lexical re-ranking (keyword exact-match boost) to reduce irrelevant hits for short queries (e.g. `weapon`)
- **Markdown translation layout fix**:
  - Markdown content now translates at paragraph-block level (not sentence-fragment level)
  - translated output is rendered as Markdown/GFM to preserve headings/lists/code/table structure
  - translation prompt explicitly requires Markdown structure preservation
- **Audiobook UX improvements**:
  - background playback kept alive when switching tool tabs
  - floating mini player added for global control (`Play/Pause/Stop`)
  - floating player supports minimize/close; default state is minimized
  - stop/cancel path no longer reports false `Audio playback failed` errors
- **Summary panel UX**:
  - copy action added and moved to a compact icon button in the summary result card
  - generate button visual weight reduced to fit panel hierarchy
- **App icon refresh**:
  - Tauri application icon set regenerated (`icns/ico/png`) from new brand mark
  - includes desktop bundle and platform icon assets in `src-tauri/icons`

- **Offline-first local embedding** with `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dims) and SQLite storage.
- **Embedding profile controls** in Settings:
  - provider / model / dimension / auto-reindex
  - optional local model path (`embedding_local_model_path`) for pre-downloaded model files.
- **Automatic full-document indexing** on document load/open (with manual `Rebuild Index` fallback).
- **Model download resilience**:
  - mirror fallback for model download (including `hf-mirror`)
  - configurable embedding download base URL (`embedding_download_base_url`)
  - local model path validation before indexing/search.
- **Search UX upgrades**:
  - search result click-to-jump fixed
  - matched paragraphs are highlighted in reader content.
- **Markdown reading reworked**:
  - render full document content in reader (not section-snippet preview only)
  - proper Markdown/GFM rendering via `react-markdown` + `remark-gfm`.
- **Reader UI cleanup**:
  - Settings modal supports scroll + close (including `Esc`)
  - right Tool panel supports resize/collapse and internal scrolling.
- **System menu integration** (macOS):
  - translation direction moved into top menu
  - menu text follows system language.
- **Audiobook / TTS improvements**:
  - Edge TTS + CosyVoice provider support
  - Edge TTS command stability fixes (`--file` input instead of direct `--text`)
  - optional Edge proxy setting (`edge_tts_proxy`)
  - better fallback/error handling for network/voice/no-audio scenarios
  - Edge TTS voice dropdown in Audiobook panel with expanded presets (US/UK/AU/CA English + CN/HK Chinese)
  - voice options are filtered by current reading language to reduce mismatch failures
  - reading highlight and auto-follow during playback
  - Markdown marker cleanup before TTS (avoid reading symbols like `*`).
  - CosyVoice supports custom `voice` + `speed` controls from Audiobook panel
  - CosyVoice endpoint auto-detection:
    - full endpoint mode: `http://host/v1/audio/speech` (no extra suffix appended)
    - base URL mode: `http://host` / `http://host/v1` (auto expands to OpenAI-style speech endpoint, with legacy `/tts` fallback)
  - click-to-start reading: click a sentence/paragraph in Reader to start playback from that position
  - text sanitization before sentence split/TTS (filters control chars and malformed replacement glyphs)
- **Translation stability improvement**:
  - server-side timeout (30s) to avoid endless `Translating...` state.

### 📖 Core Reading Experience
- **Library Management**: Import and organize EPUB, PDF, and Markdown documents
- **Advanced Reader**: Table of Contents navigation, section/paragraph-based reading
- **Semantic Search**: AI-powered search across all indexed paragraphs
- **PDF Support**: Full PDF parsing and reading capabilities
- **Markdown Support**: Import and read full Markdown documents with proper formatting
- **Text-to-Speech (TTS)**: Audiobook functionality with multiple voice options

### 🤖 AI-Powered Tools (Flexible AI Provider Support)
- **Summarization**: Organize and summarize content with configurable styles
  - Target scope: Full document / Current section / Current paragraph
  - Styles: Brief (1-2 sentences), Detailed (multi-paragraph), Bullet points
  - Smart caching to avoid redundant generations
- **Translation**: Translate content to Chinese or English
- **Bilingual Mode**: Side-by-side original and translated text view
- **Context Chat (new)**:
  - multi-turn Q&A based on current paragraph/section/document context
  - preserves short conversation history for follow-up questions
  - supports quick handoff from selection via `Explain`
- **Notes Workspace (new)**:
  - capture selected snippets via `Take Notes`
  - centralized per-document notes list for review and editing
  - import/export notes for backup and workflow integration
- **Text-to-Speech (TTS)**: Audiobook functionality with multiple voice options
  - **Edge TTS Engine**: Uses Microsoft Edge's TTS service for high-quality voices
  - **Installation**: Requires Python and edge-tts package
    ```bash
    python3 -m pip install --user --break-system-packages edge-tts
    ```
  - **Optional proxy** (if Edge TTS network is blocked): configure `Edge TTS Proxy` in Settings
  - Adjustable playback speed
  - Voice selection (multiple languages and accents)
  - Text highlighting + auto-follow while reading
- **MCP Integration**: Model Context Protocol host server for external AI assistants
- **Multiple AI Providers**:
  - **LM Studio**: Run AI completely locally for maximum privacy
  - **OpenAI**: Use cloud-based AI for convenience without local models
  - Easy switching between providers in settings

### 🔒 Privacy & Flexibility
- **Local-First Option**: All AI features can run locally using LM Studio
- **Cloud Option**: Use OpenAI API when local resources are limited
- **Your Choice**: Switch between local and cloud AI anytime
- **No Forced Cloud**: Data never leaves your device when using LM Studio
- **Offline Capable**: Works without internet when using local AI

## 📸 Screenshots

*(Coming soon - add screenshots of the application interface)*

## 🚀 Installation

### Download Pre-built Binaries

Grab the latest release for your platform from the [Releases](https://github.com/joqk12345/E-reader/releases) page.

- **macOS** (Intel & Apple Silicon): `.dmg` installer
- **Linux**: `.deb` package or `.AppImage`
- **Windows**: `.msi` or `.exe` installer

### Install via Homebrew (macOS)

```bash
brew tap joqk12345/tap
brew list --cask reader >/dev/null 2>&1 && brew upgrade --cask reader || brew install --cask --adopt reader
```

### Build from Source

#### Prerequisites

- **Node.js** 22+
- **Rust** (latest stable)
- **AI prerequisite (for Summary/Translate/Chat features)**:
  - Configure an AI provider in Reader settings before using AI tools.
  - If you use local mode, set up **LM Studio** first (run local server, load model, then set URL/model names in Reader).
- **System dependencies** (Linux only):
  ```bash
  sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf
  ```

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/joqk12345/E-reader.git
cd E-reader

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## 🎯 Usage

### Importing Documents

1. Click the **Import** button in the library
2. Select EPUB, PDF, or Markdown files from your computer
3. Documents are automatically indexed for semantic search

**Supported Formats:**
- **EPUB**: Standard e-book format
- **PDF**: Portable Document Format
- **Markdown**: Lightweight markup language (`.md`, `.markdown`)

### Library Home

- View switch: `Grid` / `List` / `Compact`
- Basic filter: file type (`All/EPUB/PDF/Markdown`) + keyword + sorting (`Recent/Title/Type`)
- Auto organization:
  - documents are auto-tagged and auto-categorized from title + content preview
  - use `Category` filter for quick narrowing
  - use `Grouped/Ungrouped` to switch grouped display
  - grouped display supports category collapse/expand and `Show more / Show less`

### Reading & Navigation

- **Table of Contents**: Use the TOC panel to navigate between chapters/sections
- **Search**: Use the Search panel to find content semantically (not just keyword matching)
- **Hybrid Search Ranking**: Semantic retrieval is re-ranked with lexical keyword signals for better precision on short queries
- **Search Timeout Protection**: long-running semantic/keyword requests now fail fast with user-facing timeout hints
- **Search Highlight**: Search hits are highlighted in the reading content
- **Pin Locations**: Double-click locations in the TOC to pin them for quick access
- **Selection Actions**:
  - select text in Reader to open quick actions popover
  - `Explain`: send selection to `Chat` for contextual explanation
  - `Take Notes`: append selection to `Notes` tab under current document
- **Text-to-Speech**: Use the Audiobook panel to listen to content
  - Click the **Audiobook** tab in the right sidebar
  - Select provider, then choose voice from dropdown (`Auto` or specific accent/speaker), and playback speed
  - You can click sentence/paragraph text in Reader to start from that location
  - Click **Play** to start listening
  - Reader auto-scrolls and highlights currently reading content
  - Use the floating mini player for global playback control when not in the Audio tab
- **Reader Themes & View Settings**:
  - Click the **Settings** button in the reader header to customize reading experience
  - Settings structure:
    - `Appearance`: theme + layout view options
    - `Editor` (`Typography`): font size, line height, content width, CJK spacing, expand-details
  - **Themes**: Choose from 5 presets - White, Paper, Mint, Sepia, Night
  - **Font Size**: Adjust from 12px to 30px (shortcut: `Cmd/Ctrl+=` / `Cmd/Ctrl+-` / `Cmd/Ctrl+0`)
  - **Line Height**: Adjust from 1.2 to 2.4
  - **Content Width**: Adjust from 36em to 120em
  - **Two-Column Layout**: Pagination density auto-adjusts based on viewport size
  - **CJK Letter Spacing**: Optional extra spacing for Chinese/Japanese/Korean text
  - All settings are persisted automatically

### AI Features Setup

Reader supports two AI providers - choose based on your needs:

> Important: Configure your AI provider first.  
> For local mode, you must set up LM Studio (server running + model loaded) before using Summary/Translate/Chat.

#### Option 1: LM Studio (Local, Privacy-First)

**Best for**: Maximum privacy, offline usage, no API costs

1. **Install LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai)
2. **Start a Local Server**: In LM Studio, start a local inference server (default: `http://localhost:1234/v1`)
3. **Load a Model**: Download and load a suitable model (recommended: Llama 3.1, Qwen 2.5, or similar)
4. **Configure Reader**:
   - Open Settings (⚙️)
   - Select "LM Studio (Local)" as AI Provider
   - Enter LM Studio URL: `http://localhost:1234/v1`
   - Set model names for embeddings and chat (via `Embedding Model` and `Chat Model`)
5. **Use AI Tools**: Open the Summary or Translate panels in Reader

### Embedding Setup (Recommended: Local Offline)

1. Open **Settings → Embedding**
2. Set:
   - `Embedding Provider`: `local_transformers`
   - `Embedding Model`: `Xenova/all-MiniLM-L6-v2`
   - `Embedding Dimension`: `384`
   - `Auto reindex`: `On`
3. (Optional) If model files are already downloaded locally, set `Local Model Path`.
4. (Optional) If direct download is blocked, set `Embedding Download Base URL` (e.g. `https://hf-mirror.com`).
5. Save settings. Indexing will run automatically when opening a document (full document scope), or use `Rebuild Index` manually.

If your network/proxy returns HTML or download errors, verify proxy settings and model name first.

#### Manual Model Download (Fallback)

If in-app model download fails, run this command locally and then set `Local Model Path` to the downloaded directory.

```bash
MODEL="Xenova/all-MiniLM-L6-v2"
BASE_URL="https://hf-mirror.com"   # If Hugging Face is reachable, you can use https://huggingface.co
TARGET="$HOME/Models/Xenova_all-MiniLM-L6-v2"

mkdir -p "$TARGET/onnx"

for f in \
  config.json \
  tokenizer.json \
  tokenizer_config.json \
  onnx/model_quantized.onnx \
  special_tokens_map.json \
  onnx/model.onnx
do
  url="$BASE_URL/$MODEL/resolve/main/$f"
  out="$TARGET/$f"
  mkdir -p "$(dirname "$out")"
  echo "Downloading $f ..."
  if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 "$url" -o "$out"; then
    if [[ "$f" == "special_tokens_map.json" || "$f" == "onnx/model.onnx" ]]; then
      echo "Optional file skipped: $f"
      continue
    fi
    echo "Required file failed: $f"
    exit 1
  fi
done

echo "Done: $TARGET"
ls -lh "$TARGET" "$TARGET/onnx"
```

#### Option 2: OpenAI (Cloud, Convenient)

**Best for**: Better performance, no local hardware requirements, quick setup

1. **Get an API Key**:
   - For OpenAI: Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys) to get your API key
   - For other OpenAI-compatible services: Obtain API key from your provider
2. **Configure Reader**:
   - Open Settings (⚙️)
   - Select "OpenAI (Cloud)" as AI Provider
   - Enter your API Key (usually starts with `sk-`)
   - Customize API Endpoint (optional): For OpenAI-compatible services like Azure OpenAI or third-party APIs
   - Set model names:
     - Embeddings: `text-embedding-3-small` (OpenAI recommended), or compatible model name from your provider
     - Chat (`Chat Model`): `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`, or a compatible chat model from your provider
3. **Save and Use**: All AI features will now use the configured OpenAI-compatible service

#### Switching Between Providers

You can switch between LM Studio and OpenAI anytime in Settings without losing data or configuration.

### Summarization

整理文章即"内容摘要/结构化整理"，用于快速把文章重点提炼成可读的概要。

**Entry Point**: Right sidebar `Summary` panel
**Scopes**:
- Full Document: Comprehensive overview
- Current Section: Chapter-level summary
- Current Paragraph: Quick context

**Styles**:
- `brief`: 1-2 sentence overview
- `detailed`: Multi-paragraph comprehensive summary
- `bullet`: Key points as a list

**Usage Steps**:
1. Open an EPUB/PDF in the reader
2. (Optional) Select a specific section or paragraph
3. Open the `Summary` panel
4. Choose your preferred style and scope
5. Click **Generate Summary**
6. Results are cached - regenerate to refresh
7. Use the copy icon in the result card to copy summary text quickly

### Translation & Bilingual View

- **Translation Panel**: Translate selected text or current paragraph
- **Bilingual View**: Side-by-side display of original and translated text
- **Languages**: Support for Chinese ↔ English
- **Caching**: Translations are cached per paragraph for efficiency

## 🤖 AI Provider Comparison

| Feature | LM Studio (Local) | OpenAI (Cloud) |
|---------|------------------|----------------|
| **Privacy** | ✅ 100% local, data never leaves device | ⚠️ Data sent to OpenAI servers |
| **Cost** | ✅ Free (after model download) | 💰 Pay-per-use API fees |
| **Speed** | ⚠️ Depends on hardware | ✅ Fast, cloud-optimized |
| **Quality** | ⚠️ Varies by model | ✅ State-of-the-art models |
| **Offline** | ✅ Works without internet | ❌ Requires internet |
| **Setup** | ⚠️ Requires model download | ✅ Quick API key setup |
| **Hardware** | 💻 Needs capable computer | 🌐 Any device |
| **Embedding Models** | text-embedding-ada-002 (compatible) | text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002 |
| **Chat Models** | Llama 3.1, Qwen 2.5, Mistral, etc. | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |

### Recommended Use Cases

**Choose LM Studio when you:**
- Need maximum privacy and data security
- Want to avoid API costs
- Have a powerful computer
- Prefer offline usage
- Work with sensitive documents

**Choose OpenAI when you:**
- Want the best AI quality
- Have limited hardware resources
- Need faster processing
- Don't mind paying for API usage
- Want quick setup without downloading models

### Configuration Examples

**LM Studio Configuration:**
```json
{
  "provider": "lmstudio",
  "lm_studio_url": "http://localhost:1234/v1",
  "embedding_provider": "local_transformers",
  "embedding_model": "Xenova/all-MiniLM-L6-v2",
  "embedding_dimension": 384,
  "embedding_auto_reindex": true,
  "chat_model": "qwen2.5-7b-instruct"
}
```

**OpenAI Configuration:**
```json
{
  "provider": "openai",
  "lm_studio_url": "http://localhost:1234/v1",
  "embedding_model": "text-embedding-3-small",
  "chat_model": "gpt-4o",
  "openai_api_key": "sk-your-api-key-here",
  "openai_base_url": "https://api.openai.com/v1"
}
```

> 💡 **Tip**: You can switch between providers anytime in Settings. Your embeddings and cached translations/summaries remain intact!

## 🔧 Development

### Project Structure

```
reader/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/         # React components
│   ├── store/             # Zustand state management
│   └── ...
├── src-tauri/             # Backend (Rust)
│   ├── src/
│   │   ├── commands/      # Tauri commands
│   │   ├── database/      # SQLite database & embeddings
│   │   ├── parsers/       # EPUB/PDF parsers
│   │   ├── search/        # Semantic search
│   │   └── mcp/           # MCP server implementation
│   └── ...
├── .claude/               # Claude Code project constraints & workflows
│   ├── rules/             # Automatic loading hard constraints (coding standards, verification steps)
│   ├── commands/          # Reusable slash command process templates
│   └── settings.json      # Shared team preferences & permissions
├── .github/workflows/     # CI/CD configurations
├── scripts/               # Utility scripts
└── .mcp.json              # MCP (Model Context Protocol) server configuration
```

### Development Tools & Workflow

#### Claude Code Integration

Reader 项目已配置 Claude Code 开发助手，提供标准化的开发流程和约束：

**Key Features:**
- 内置开发流程模板（`.claude/commands/`）
- 编码规范和验证步骤（`.claude/rules/`）
- 项目级设置（`.claude/settings.json`）
- 支持 MCP（Model Context Protocol）服务器

**Usage:**
```bash
# 使用 Claude Code 进行开发约束检查
# 自动遵循项目规则和最佳实践
```

#### Hooks 开发助手

项目配置了 Claude Code 开发钩子（Hooks），提供智能提示词优化功能：

**prompt 优化钩子 (`refine_prompt.mjs`)**:
- **功能**：自动优化用户输入的提示词，提高与 Claude Code 的协作效率
- **触发方式**：在输入前添加前缀 `::` 或 `>>`（支持中文冒号）
  - `:: 把这个函数改成异步的`
  - `>> make the thing work better`
- **优化逻辑**：
  - 使用腾讯 Hunyuan-MT-7B 模型进行专业翻译
  - 保留原始意图，不添加/删除需求
  - 自动识别语言类型，避免语言混合问题
  - 保留技术术语，保持原意的同时优化表达
  - 使用祈使语气，明确范围
  - 移除冗余词汇
  - 支持中英文输入
- **结果**：优化后的提示词会自动复制到剪贴板，粘贴后即可发送

**翻译功能配置**：
- 使用硅基流动 API：`https://api.siliconflow.cn/v1/chat/completions`
- 模型：tencent/Hunyuan-MT-7B（专业翻译模型）
- 支持环境变量配置：`SILICONFLOW_APPKEY`

**工作原理**：
- 钩子配置在 `.claude/settings.json` 中（UserPromptSubmit 类型）
- 自动加载项目上下文（project-context.txt）提供领域知识
- 使用 pbcopy 自动复制到剪贴板（支持 macOS）

#### MCP (Model Context Protocol)

项目配置了 MCP 服务器，支持与外部 AI 助手集成：

**Configured Servers:**
- `reader`: Reader MCP server（`reader.*` 工具集合，面向 Codex/Claude Code）
- `tauri`: Tauri MCP 服务器，提供应用状态和操作访问
- `codex`: Codex CLI 集成
- `chrome-devtools`: Chrome DevTools 集成

`reader` server 配置风格参考 VMark MCP Setup：客户端只需安装一个本地 `command`。
`reader` 为业务层工具（SQLite 文档数据操作，支持 Markdown/PDF/EPUB），`tauri` 为开发/调试层工具（Tauri IPC）。

**Reader MCP command:**
```bash
./mcp-server/bin/reader-mcp-server.sh
```

**Reader tools (MCP):**
- `reader.list_documents` (from Reader SQLite documents table)
- `reader.open_document` (by `doc_id`/`path`/`title`, content from paragraphs table)
- `reader.get_markdown_outline` (from sections table)
- `reader.search_markdown` (paragraph full-text search in SQLite)
- `reader.semantic_search_documents` (cross-document semantic retrieval from embeddings table)
- `reader.import_document` (import local Markdown/PDF/EPUB file into Reader SQLite)

`reader.list_documents` 参数可用 `file_types` 过滤，如 `["pdf"]` 或 `["epub"]`。
`reader.import_document` 现支持 Markdown/PDF/EPUB 导入（PDF 依赖 `pdftotext`，EPUB 依赖 `unzip`）。
`reader.semantic_search_documents` 支持全库语义检索，默认跨文档返回 `top_k=10`，可用 `scan_limit` 和 `batch_size` 控制大库候选扫描规模。

**Usage:**
```bash
# 1) 客户端加载项目根目录 .mcp.json
# 2) 通过 reader server 调用 reader.* 业务工具
# 3) 若要使用 tauri server，再启动 reader app（ws://localhost:9324）
```

### Running Tests

```bash
# Frontend type checking
npm run build

# Backend tests
cd src-tauri
cargo test

# Linting
cargo clippy
cargo fmt --check
```

### Building Releases

See [RELEASE.md](./RELEASE.md) for detailed release instructions.

Quick version:

```bash
# Use the release script
./scripts/release.sh 0.4.1

# Or manually
git tag v0.4.1
git push origin v0.4.1
```

GitHub Actions will automatically build binaries for all platforms.

## 🛠️ Technology Stack

**Frontend**:
- React 18 with TypeScript
- Vite for fast development
- TailwindCSS for styling
- Zustand for state management
- React Router for navigation

**Backend**:
- Rust with Tauri 2
- SQLite for data persistence
- Serde for serialization
- Tokio for async runtime

**AI/ML**:
- Local inference via LM Studio
- Semantic search with embeddings
- OpenAI-compatible API interface

## 📝 License

[Your License Here]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Contact

[Your Contact Information]

## 🙏 Acknowledgments

- Tauri team for the amazing framework
- LM Studio for local AI capabilities
- All contributors to the open-source ecosystem
