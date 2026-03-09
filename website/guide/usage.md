# User Manual

This page covers the main end-user workflows in Reader. It focuses on the current desktop UI and recent features added in the `0.4.12` to `0.4.14` releases.

## 1. Import documents into the library

1. Open the Library view.
2. Click `Import`.
3. Choose a local `EPUB`, `PDF`, or `Markdown` file.
4. Wait for Reader to finish importing and indexing.

After import, use these controls to narrow the library:

- `Formats`: `All`, `Markdown`, `PDF`, `EPUB`
- `Category`: favorites and grouped browsing
- Search box: match title, author, or path
- View switch: `Grid`, `List`, `Compact`

## 2. Open a document and choose the reading mode

Inside Reader, the top toolbar contains `Reading View`.

### `Text Parse`

Use `Text Parse` when you want the cleanest text-first view for Markdown and structured reading.

### `Multimedia Parse`

Use `Multimedia Parse` when you want media-aware Markdown rendering, especially for web-imported content or documents that contain inline image placeholders and linked assets.

### Bilingual modes

Once translation is enabled, `Reading View` also lets you switch among:

- `Source Only`
- `Translation Only`
- `Source + Translation`

This is the fastest way to move between monolingual reading and side-by-side comparison.

## 3. Understand difficult passages

Select text in the reader to open the selection actions. Recent versions reworked reading-comprehension actions around the `Understand` panel.

### `Explain Simply`

Use this when a sentence is dense or overly technical. Reader returns a plain-language explanation and key points.

### `With Context`

Use this when the selected text depends on nearby paragraphs. Reader includes surrounding context before generating the explanation.

### `Term`

Use this for terminology. Reader structures the result into:

- `Term Meaning`
- `Why It Matters Here`
- `Common Renderings In This Document`
- `Concept Tags`

If Reader finds related passages in the same document, it also shows `Related Passages In This Document` with jump links.

### `Takeaway`

Use this when you want a one-line learning note from the current selection.

## 4. Build and maintain a glossary

Reader now includes a dedicated `Glossary` panel.

Use it to:

- Browse glossary entries for the current document or all documents
- Edit `Preferred Rendering`
- Edit `Concept Tags`
- Remove single entries
- Clear the current glossary scope

`Term` analysis and `Glossary` work together. If you pin a preferred rendering in `Understand`, that choice is reused later for the same document so terminology stays consistent.

## 5. Organize documents with tags

Reader now has a real tag system instead of local inferred labels.

### Filter the library by tags

The Library sidebar shows available tags and supports two matching modes:

- `Any`
- `All`

Use this to narrow large libraries by theme, project, topic, or workflow stage.

### Tag the current document

Open the right-side `Tags` panel to:

- review current tags
- add an existing tag
- add a new tag
- refresh AI suggestions
- accept matched suggestions
- `Map` a suggestion to an existing tag
- `Create Temp` for a provisional tag
- `Reject` low-quality suggestions

The same panel can also show `Related Documents` based on shared tags.

## 6. Run batch tag workflows

Use `Batch Tags` from the Library when you need to update many documents at once.

Typical flow:

1. Open `Batch Tags`.
2. Decide whether to `Use current library results`.
3. Narrow the scope by date range and document search.
4. Choose one mode:
   - `Run AI Suggestions`
   - `Apply Existing Tags`
5. Review the matched documents before applying changes.

When filtering target documents by existing tags, choose:

- `Match Any`
- `Match All`

This is useful for backfilling a large library after importing a new reading set.

## 7. Maintain the tag taxonomy

Use `Tag Library` for cleanup and normalization.

Available actions:

- `Rename`
- `Merge`
- `Add Alias`
- `Promote` temporary tags into regular tags
- `Cleanup Unused`

This keeps the library stable after heavy AI-assisted tagging.

## 8. Use search, notes, and TTS during reading

Reader still supports its broader reading workflows:

- semantic search across indexed content
- translation and bilingual reading
- notes capture from selected text
- annotations and highlights
- audiobook / TTS playback with follow-along reading

If you want setup details for installation or external automation, continue with:

- [Installation](/guide/install)
- [What's New](/guide/whats-new)
- [MCP Tools Reference](/guide/mcp-tools)
