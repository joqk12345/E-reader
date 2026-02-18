# MCP Tools Reference

This page lists the MCP tools exposed by Reader's standalone MCP server.

Source of truth:

- `mcp-server/src/tools/markdown-tools.mjs`

## Tool List

- `reader.list_documents`
- `reader.open_document`
- `reader.get_markdown_outline`
- `reader.search_markdown`
- `reader.semantic_search_documents`
- `reader.import_document`

Compatibility aliases accepted by `tools/call`:

- `reader.list_markdown_documents` -> `reader.list_documents`
- `reader.open_markdown_document` -> `reader.open_document`

## 1) reader.list_documents

Description: List documents from Reader SQLite (`markdown` / `pdf` / `epub`).

Input schema summary:

- `db_path?: string` optional DB path override
- `limit?: integer` range `1..500`, default `100`
- `file_types?: string[]` enum values: `markdown`, `pdf`, `epub`

Example:

```json
{
  "limit": 50,
  "file_types": ["markdown", "pdf"]
}
```

## 2) reader.open_document

Description: Read document content by one locator.

Locator requirement (any one):

- `doc_id`
- `path`
- `title`

Input schema summary:

- `db_path?: string`
- `doc_id?: string`
- `path?: string`
- `title?: string`
- `max_chars?: integer` range `200..400000`, default `12000`

Example:

```json
{
  "doc_id": "doc_xxx",
  "max_chars": 16000
}
```

## 3) reader.get_markdown_outline

Description: Return section outline for a target document.

Locator requirement (any one):

- `doc_id`
- `path`
- `title`

Input schema summary:

- `db_path?: string`
- `doc_id?: string`
- `path?: string`
- `title?: string`

Example:

```json
{
  "title": "Deep Learning with Python"
}
```

## 4) reader.search_markdown

Description: Keyword search in paragraph content, optional document scope.

Input schema summary:

- `db_path?: string`
- `doc_id?: string`
- `path?: string`
- `title?: string`
- `query: string` required
- `case_sensitive?: boolean` default `false`
- `limit?: integer` range `1..200`, default `20`

Example:

```json
{
  "query": "transformer",
  "limit": 20,
  "case_sensitive": false
}
```

## 5) reader.semantic_search_documents

Description: Cross-document vector similarity search over embedding index.

Required condition (any one):

- `query` (natural language)
- `query_vector` (precomputed embedding)

Input schema summary:

- `db_path?: string`
- `query?: string`
- `query_vector?: number[]`
- `top_k?: integer` range `1..200`, default `10`
- `min_score?: number` range `-1..1`, default `-1`
- `scan_limit?: integer` range `10..200000`, default `20000`
- `batch_size?: integer` range `200..5000`, default `2000`
- `doc_id?: string`
- `path?: string`
- `title?: string`
- `file_types?: string[]` enum: `markdown`, `pdf`, `epub`
- `embedding_profile?: { provider?: string; model?: string; dimension?: integer }`
- `embedding_provider?: string`
- `embedding_model?: string`
- `embedding_dimension?: integer`
- `lm_studio_url?: string`
- `openai_base_url?: string`
- `openai_api_key?: string`
- `embedding_ollama_url?: string`
- `embedding_ollama_model?: string`
- `local_model_path?: string`

Example:

```json
{
  "query": "what are the key claims in chapter 3",
  "top_k": 8,
  "file_types": ["markdown"]
}
```

## 6) reader.import_document

Description: Import local markdown/pdf/epub file into Reader database.

Input schema summary:

- `db_path?: string`
- `path: string` required
- `title?: string`
- `author?: string`
- `language?: string`
- `force_reimport?: boolean` default `false`

Example:

```json
{
  "path": "/Users/me/Documents/book.epub",
  "force_reimport": true
}
```

## MCP Resources (also exposed)

- `reader://project`
- `reader://database`
- `reader://documents/recent`
