# Reader V1 Product Design (Tauri 2 + React, Offline, EPUB-first)

Date: 2026-01-23
Owner: Product/Engineering

## 1. Overview
Build a local-first reader for EPUB with offline embedding + LLM, and a built-in MCP Host that exposes reader capabilities to external assistants (Codex, Claude Code). The product focuses on reading, translation, summarization, and bilingual mode while maintaining strict offline operation.

## 2. Goals
- EPUB-first reading with chapter/paragraph navigation.
- Offline semantic search and precise jump-to-location.
- Local summarization and translation (CN/EN).
- Bilingual side-by-side reading with synced scrolling.
- MCP-only external API (no HTTP/remote), exposing core reader tools.

## 3. Non-goals (V1)
- Cloud sync, accounts, or collaboration.
- PDF/HTML/MD as primary formats (future).
- External tool marketplace or plugin store.
- Online model calls or telemetry.

## 4. Target platform
- macOS on Apple Silicon (M2), offline only.

## 5. UX Information Architecture
- Library: document list, import, sort.
- Reader: TOC, content, tool panel, search, bilingual toggle.
- Settings: models, language prefs, cache.

## 6. UI Layout (V1)
- Top bar: back to Library, doc title, in-doc search, view mode toggle.
- Left panel: TOC (chapters/sections).
- Center: reader content (EPUB rendering).
- Right panel: tools (summary, translation, search results, task queue).
- Bilingual mode: split center content into original/translation with synced scroll.

## 7. Core User Flows
### 7.1 Import EPUB
Library -> Import -> parse EPUB -> store metadata -> show in list.

### 7.2 Read and Navigate
Open doc -> TOC select -> scroll to chapter -> update current section.

### 7.3 Search
Search query -> semantic search -> list results -> click -> jump + highlight.

### 7.4 Summarize/Translate
Select paragraph or section -> invoke local LLM -> store cached result.

### 7.5 Bilingual Mode
Toggle bilingual -> generate missing translations -> render side-by-side.

## 8. Architecture
### 8.1 High-level
- Tauri 2 app with React frontend.
- Rust backend for parsing, indexing, model orchestration, and MCP Host.
- SQLite for metadata, structure, and vector index.

### 8.2 Modules (Rust)
- epub_parser: parse EPUB (ZIP + OPF/NCX/XHTML).
- indexer: chunking + embedding + vector search.
- llm: local LLM inference (summary/translation).
- db: SQLite schema and migrations.
- mcp_host: tool registration and calls.
- commands: Tauri commands for UI.

### 8.3 Modules (React)
- Library, Reader, Search, Bilingual, Settings pages.
- TOCPanel, ReaderContent, ToolPanel, SearchPanel, BilingualView components.

## 9. Data Model (SQLite)
- documents(id, title, author, language, file_path, created_at)
- sections(id, doc_id, title, order_index, href)
- paragraphs(id, doc_id, section_id, order_index, text, location)
- embeddings(id, paragraph_id, vector, dim)
- cache_summaries(id, paragraph_id|section_id, style, summary)
- cache_translations(id, paragraph_id, target_lang, translation)

## 10. MCP Tool API (External Assistants)
Only MCP (no HTTP). Tools return JSON payloads.

- reader.search(query, top_k, scope) -> [{ paragraph_id, snippet, score, location }]
- reader.get_section(doc_id, section_id) -> { title, paragraphs: [...] }
- reader.summarize(doc_id, section_id | paragraph_id, style) -> { summary }
- reader.translate(text | paragraph_id, target_lang) -> { translation }
- reader.bilingual_view(paragraph_id) -> { original, translation }
- reader.open_location(doc_id, location) -> { ok }

### 10.1 MCP Tool Schemas (Draft)
All tools accept JSON objects. Optional fields are marked with "?". Errors follow the error schema below.

Common types:
- doc_id: string
- section_id: string
- paragraph_id: string
- location: string (EPUB CFI or internal anchor)
- lang: "zh" | "en"
- style: "brief" | "detailed" | "bullet"

reader.search
Request:
{
  "query": "string",
  "top_k"?: number,
  "scope"?: { "doc_id"?: "string", "section_id"?: "string" }
}
Response:
{
  "results": [
    {
      "paragraph_id": "string",
      "snippet": "string",
      "score": number,
      "location": "string"
    }
  ]
}

reader.get_section
Request:
{ "doc_id": "string", "section_id": "string" }
Response:
{
  "title": "string",
  "paragraphs": [
    { "paragraph_id": "string", "text": "string", "location": "string" }
  ]
}

reader.summarize
Request:
{
  "doc_id"?: "string",
  "section_id"?: "string",
  "paragraph_id"?: "string",
  "style"?: "brief" | "detailed" | "bullet"
}
Response:
{ "summary": "string" }

reader.translate
Request:
{
  "text"?: "string",
  "paragraph_id"?: "string",
  "target_lang": "zh" | "en"
}
Response:
{ "translation": "string" }

reader.bilingual_view
Request:
{ "paragraph_id": "string" }
Response:
{ "original": "string", "translation": "string" }

reader.open_location
Request:
{ "doc_id": "string", "location": "string" }
Response:
{ "ok": true }

### 10.2 MCP Error Schema
Errors return a single object with stable codes.
{
  "error": {
    "code": "string",
    "message": "string",
    "details"?: { "key": "value" }
  }
}

Suggested error codes:
- invalid_args: required fields missing or incompatible
- not_found: document/section/paragraph not found
- not_indexed: embeddings or index missing
- model_busy: model locked or busy
- model_failure: model failed during inference
- permission_denied: access to path or doc not allowed
- internal_error: unexpected failure

## 11. Event Flows (Core)
- Doc open: open_document -> load metadata + sections -> render content.
- TOC select: get_section -> scroll to anchor -> highlight.
- Search: search -> results -> click -> jump + highlight.
- Summarize/Translate: invoke llm -> cache -> render.
- Bilingual: toggle -> ensure translations -> render split view.

## 12. Performance Targets
- Import 1MB EPUB < 5s.
- First search response < 1s for < 10k paragraphs.
- Translation per paragraph < 2s on M2.

## 13. Privacy/Security
- Offline-only, no network calls.
- MCP tools restricted to imported documents.
- File access limited to user-selected paths.

## 14. Milestones
M0: EPUB import + TOC + reader UI.
M1: SQLite schema + paragraph indexing.
M2: Embedding + semantic search.
M3: Local LLM summary/translation.
M4: MCP Host tools.
M5: Bilingual mode and polish.

## 15. Open Questions
- Choose EPUB parsing crate and vector extension for SQLite.
- Decide on local LLM runtime (llama.cpp vs embedded service).
- Define CFI or location mapping strategy for robust jumps.

## 16. Decisions (Proposed Defaults)
These defaults unblock implementation and can be revised later.

- MCP Transport: stdio-based MCP server embedded in the app process. External assistants connect via local stdio session managed by the host app.
- Vector Indexing: SQLite with vector extension, cosine similarity, dimension fixed by chosen embedding model.
- EPUB Location: EPUB CFI stored per paragraph for stable jump-to-location and highlight.
- Local Runtime: llama.cpp for both embedding and LLM (gguf), with a single local model directory.

## 17. Implementation Notes (Draft)
### 17.1 MCP Transport and Session Lifecycle
- The app runs an MCP server inside the Rust backend and exposes a stdio transport endpoint.
- A local launcher (or helper command) can start the app in MCP-serve mode and proxy stdio to the MCP server.
- The server maintains a single active session per client; concurrent clients queue or are rejected with model_busy.
- Tool calls are synchronous; long-running calls (batch translation) should return progress updates via notifications.

### 17.2 SQLite Vector Indexing
- Use cosine similarity and store unit-normalized embeddings.
- Required fields: paragraph_id, vector BLOB, dim.
- Index creation occurs after initial import or on-demand after first query.
- Search flow: embed query -> vector search -> fetch paragraph text/location -> build snippets.

### 17.3 EPUB CFI Strategy
- During parsing, compute an EPUB CFI per paragraph or block element.
- Store CFI as the primary `location` field.
- Reader scroll/jump uses CFI to locate nodes in the rendered DOM.
- If CFI is missing, fall back to section href + paragraph index.

### 17.4 Local Model Runtime
- llama.cpp used for both embedding and LLM (gguf).
- Model directory: `~/.reader/models/` (configurable in Settings).
- Embedding model and LLM model are configured separately but share the runtime.
