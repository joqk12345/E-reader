# What's New

This page summarizes the most recent user-facing updates now reflected in the website docs. The changes below cover the latest feature work in `v0.4.12` through `v0.4.14`.

## `v0.4.14`: document tags and library workflows

Reader now includes a complete document tag system.

### New capabilities

- real persisted tags instead of display-only inferred labels
- tag filters in the Library sidebar
- `Any` / `All` matching for multi-tag filtering
- current-document tagging in the `Tags` panel
- AI-generated tag suggestions with review actions:
  - `Accept`
  - `Create Temp`
  - `Map`
  - `Reject`
- `Related Documents` discovery based on shared tags

### New management workflows

- `Batch Tags` for bulk updates across many documents
- `Tag Library` for `Rename`, `Merge`, `Add Alias`, `Promote`, and `Cleanup Unused`

### Why it matters

This turns Reader's library organization into a reusable taxonomy instead of a one-off UI grouping system.

## `v0.4.13`: reading comprehension and glossary workflows

Reader's selection actions were reworked into a more focused understanding flow.

### New `Understand` panel

The right-side tool panel now includes:

- `Explain Simply`
- `With Context`
- `Term`
- `Takeaway`

Each action is optimized for a different reading problem:

- simplify hard language
- include nearby context
- analyze important terminology
- extract a study note

### New glossary system

Reader now stores local glossary entries and lets you:

- save a `Preferred Rendering`
- store `Concept Tags`
- browse entries in the `Glossary` panel
- reuse saved terminology choices in later `Term` analysis

### Why it matters

Reader is no longer limited to one-off explanations. It can now accumulate terminology decisions and reuse them while you keep reading.

## `v0.4.12`: text parse and multimedia parse modes

Reader added more flexible Markdown reading modes.

### New reading view controls

The `Reading View` menu now groups:

- `Text Parse`
- `Multimedia Parse`
- `Source Only`
- `Translation Only`
- `Source + Translation`

### What changed

- `Text Parse` keeps Markdown reading focused and text-first
- `Multimedia Parse` improves handling for Markdown content with remote article assets, linked media, and inline image placeholders
- bilingual mode controls are now grouped with the rest of the reading view options

### Why it matters

Markdown documents can now be read in a way that better matches the source material instead of forcing a single rendering strategy.

## Also included around the same release window

- stronger AI profile management with separate provider, model, and agent configuration
- tag-aware library cards and refreshed document metadata display
- continuing support for translation, semantic search, notes, TTS, and MCP tooling

## Next

- [User Manual](/guide/usage)
- [Installation](/guide/install)
- [MCP Tools Reference](/guide/mcp-tools)
