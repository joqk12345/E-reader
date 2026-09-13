# ADR-019：下线 Markdown 文档 Feature，聚焦 EPUB

- 状态：Accepted
- 日期：2026-09-13
- 范围：Library 导入、文档筛选、阅读入口与历史数据兼容

## 背景

Reader 的主要阅读内核和产品价值集中在 EPUB。Markdown 文档阅读与 EPUB 使用不同的导入、渲染、筛选和内容分支，增加了 Reader Shell、测试和维护成本。这里的 Markdown 文档 Feature 不包括 AI 面板使用 Markdown 作为输出格式。

## 决策

1. 停止新的 Markdown 文件导入；Library 文件选择器只接受 EPUB。
2. 移除 Markdown 文档的 Library 筛选、阅读渲染和 Markdown 专属阅读设置。
3. 历史 Markdown 数据库记录和原始文件不删除、不转换、不覆盖。
4. 打开历史 Markdown 时显示明确的“不再支持”状态，并允许返回 Library 或删除记录；不得送入 EPUB 阅读流程。
5. 保留 AI、Chat、Understand、Summary 等面板对 Markdown 文本输出的渲染能力；`react-markdown` 不因本决策删除。
6. 旧 Tauri/MCP Markdown 命令暂不破坏性移除；若仍被调用，应返回稳定的 unsupported 错误，避免破坏外部客户端合同。

## 非目标

- 不修改 EPUB publication、Locator、安全边界、数据库表结构或 AI 输出合同。
- 不批量清理用户已有 Markdown 文件。
- 不把 Markdown 转换为 EPUB。

## 验收标准

- 新建导入对话框无法选择 Markdown。
- EPUB 仍可导入、打开、翻页、搜索、定位和使用阅读工具。
- 历史 Markdown 可识别、可删除，但不能进入阅读器。
- Library 不再展示 Markdown 筛选项或 Markdown 作为支持格式说明。
- AI 面板 Markdown 输出保持可渲染。
