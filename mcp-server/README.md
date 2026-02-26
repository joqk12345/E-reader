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
- `reader.summarize_context`
- `reader.translate_text`
- `reader.deep_analyze_context`
- `reader.chat_with_context`

`reader.list_documents` default includes `markdown/pdf/epub`.
Use `file_types` to filter, e.g. `["pdf"]` or `["epub"]`.
`reader.import_document` supports markdown/pdf/epub files.
`reader.semantic_search_documents` performs cross-document vector search over the embeddings table.
Key params: `query`, `top_k`, `scan_limit`, `batch_size`, optional `file_types` / `doc_id`.

## CLI Usage

This package can run in both MCP stdio mode and direct CLI mode.

```bash
# MCP stdio mode (for MCP clients)
reader-mcp-server stdio

# List available tools
reader-cli tools

# Import document (markdown/pdf/epub)
reader-cli import ./docs/book.pdf
reader-cli import ./notes/readme.md --title "My Notes"
reader-cli import ./book.epub --force-reimport

# Tool panel style commands
reader-cli search "vector database" --limit 20
reader-cli summary --doc-id <doc_id> --style brief
reader-cli translate "Hello world" --target-lang zh
reader-cli deep --doc-id <doc_id>
reader-cli chat "这篇文章核心观点是什么？" --doc-id <doc_id>

# Generic tool call
reader-cli tool reader.import_document --args '{"path":"./book.pdf"}' --pretty
```

Default DB discovery:
- macOS: `~/Library/Application Support/com.mac.reader/reader.db`
- override with `READER_DB_PATH` or per-tool `db_path`

## Logs

- server log: `/tmp/reader-business-mcp.log`
- launcher log: `/tmp/reader-mcp-launcher.log`
