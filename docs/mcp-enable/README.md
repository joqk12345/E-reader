# Reader MCP Enable

This project is MCP-enabled for Codex and Claude Code with a dedicated `reader` server entry.

## 1) Project MCP config

`.mcp.json` includes:

- `reader`: local launcher command `./mcp-server/bin/reader-mcp-server.sh`
- `tauri`, `codex`, `chrome-devtools`: existing integrations

## 2) Reader MCP launcher

`mcp-server/bin/reader-mcp-server.sh`

This launcher follows the VMark setup style (single command entry).
It starts the custom Reader business MCP server:
- script: `mcp-server/src/cli.mjs`
- package name: `@reader/mcp-server`
- npm bin: `reader-mcp-server -> ./dist/cli.js`

## 3) Reader toolset exposed via MCP

- `reader.list_documents`
- `reader.open_document`
- `reader.get_markdown_outline`
- `reader.search_markdown`
- `reader.semantic_search_documents`
- `reader.import_document`

All tools read from Reader SQLite (`reader.db`) rather than scanning the current project folder.
`reader.list_documents` defaults to `markdown/pdf/epub`; use `file_types` to filter.
`reader.import_document` supports markdown/pdf/epub import via MCP.
`reader.semantic_search_documents` supports semantic retrieval across the embedding index (`query`, `top_k`, `scan_limit`, `batch_size`).

## 4) Client install hints

- Claude Code / Codex: load project `.mcp.json`.
- Claude Desktop (global config) can use the same command path with an absolute path.

Example `claude_desktop_config.json` snippet:

```json
{
  "mcpServers": {
      "reader": {
      "command": "/ABSOLUTE/PATH/TO/reader/mcp-server/bin/reader-mcp-server.sh"
    }
  }
}
```

## 5) Runtime prerequisite

`reader` business MCP tools do not require Reader app running.
If you also use `tauri` MCP server, keep Reader app running for IPC operations.
