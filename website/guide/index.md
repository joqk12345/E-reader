# Guide

Reader is a local-first reading app for EPUB, PDF, and Markdown with built-in AI workflows for understanding, translation, search, and organization.

This guide is organized around the way people actually use the app: import documents, read with the right view mode, understand difficult passages, and keep the library organized.

## Start here

- [Installation](/guide/install): install Reader from releases or build it locally
- [User Manual](/guide/usage): day-to-day workflows inside the app
- [What's New](/guide/whats-new): recent feature updates in `v0.4.12` to `v0.4.14`
- [MCP Tools Reference](/guide/mcp-tools): tools exposed by the standalone MCP server

## Core workflows

### Import and browse

- Import EPUB, PDF, and Markdown from local files
- Browse with `Grid`, `List`, or `Compact`
- Filter by format, favorites, and tags

### Read and understand

- Switch reading mode with `Reading View`
- Use `Text Parse` for clean text-first reading
- Use `Multimedia Parse` when you want media-aware Markdown rendering
- Turn on translation, then switch among `Source Only`, `Translation Only`, or `Source + Translation`
- Select text and send it to `Understand`, `Dict`, notes, or annotation flows

### Build reusable knowledge

- Save preferred term renderings in `Glossary`
- Attach concept tags to technical vocabulary
- Apply document tags manually or through AI suggestions
- Review related documents connected by shared tags

## Architecture snapshot

- Desktop shell: Tauri 2 (Rust)
- Frontend: React + TypeScript
- Local embedding: `@xenova/transformers`
- Storage: SQLite

## Next reading

- [Installation](/guide/install)
- [User Manual](/guide/usage)
- [What's New](/guide/whats-new)
- [MCP Tools Reference](/guide/mcp-tools)
