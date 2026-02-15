# Reader MCP Server

Standalone MCP server for Reader business tools, organized similar to `vmark-mcp-server`.
Tools are data-layer oriented and query Reader's SQLite database (`reader.db`) instead of scanning the current workspace directory.

## Structure

- `dist/cli.js`: bin entry (as in npm package `bin`)
- `bin/reader-mcp-server.sh`: robust launcher (node fallback for desktop GUI environments)
- `src/cli.mjs`: stdio entrypoint
- `src/server.mjs`: MCP protocol handling (`initialize`, `tools/list`, `tools/call`)
- `src/tools/markdown-tools.mjs`: Reader business tools
- `src/utils/log.mjs`: shared logging utility

## Tools

- `reader.list_documents`
- `reader.open_document`
- `reader.get_markdown_outline`
- `reader.search_markdown`
- `reader.semantic_search_documents`
- `reader.import_document`

`reader.list_documents` default includes `markdown/pdf/epub`.
Use `file_types` to filter, e.g. `["pdf"]` or `["epub"]`.
`reader.import_document` supports markdown/pdf/epub files.
`reader.semantic_search_documents` performs cross-document vector search over the embeddings table.
Key params: `query`, `top_k`, `scan_limit`, `batch_size`, optional `file_types` / `doc_id`.

Default DB discovery:
- macOS: `~/Library/Application Support/com.mac.reader/reader.db`
- override with `READER_DB_PATH` or per-tool `db_path`

## Logs

- server log: `/tmp/reader-business-mcp.log`
- launcher log: `/tmp/reader-mcp-launcher.log`
