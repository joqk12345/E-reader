# Reader

Local-first EPUB reader built with Tauri 2 + React. Focused on offline reading, semantic search, summarization, translation, and bilingual mode.

## Features

- Library: import and manage EPUB documents
- Reader: TOC navigation, section/paragraph reading
- Semantic search across indexed paragraphs
- Summarize/organize content (see below)
- Translation and bilingual side-by-side reading
- MCP tool endpoints for external assistants (local only)

## 整理文章功能

整理文章即“内容摘要/结构化整理”，用于快速把文章重点提炼成可读的概要。

- 入口：右侧工具栏 `Summary` 面板
- 范围：支持 **全文 / 当前章节 / 当前段落** 三种目标
- 风格：`brief`（1-2 句）、`detailed`（多段落）、`bullet`（要点列表）
- 缓存：摘要结果会按目标范围与风格缓存，重复生成会直接复用
- 依赖：使用本地 LM Studio 模型进行离线整理

### 使用步骤

1. 在书库中打开一本 EPUB
2. 选择章节或段落（可选）
3. 打开 `Summary` 面板，选择风格并点击 **Generate Summary**
4. 查看整理后的内容，并在需要时切换风格或范围
