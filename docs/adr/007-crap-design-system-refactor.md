# ADR-007：Reader 0.5.4 采用 CRAP 设计重构原则

- 状态：Proposed
- 日期：2026-09-12
- 版本目标：0.5.4

## 背景

Reader 0.5.3 已完成产品能力精简，当前需要在不改变阅读与数据合同的前提下，统一 Library、Reader Chrome、工具面板和 AI 面板的视觉层级。重构采用 Robin Williams《写给大家看的设计书》的 CRAP 原则作为共同语言。

## 决策

- **Contrast（对比）**：通过语义 token、字号、字重、色彩和留白建立明确的信息层级；不使用无意义的弱对比装饰。
- **Repetition（重复）**：统一按钮、卡片、输入、状态、面板标题和焦点态的视觉规则。
- **Alignment（对齐）**：建立稳定的页面网格、内容边界、标题基线和操作区对齐关系。
- **Proximity（亲密性）**：按任务和语义分组相关操作；让标题、上下文、内容和动作保持正确距离。

CRAP 是设计验收原则，不替代可访问性、响应式、阅读主题隔离或 token 约束。

## 不变合同

- 不修改 EPUB 解析、安全边界、Locator、publication、SQLite schema 和 Tauri IPC 合同。
- 不改变搜索、翻译、AI、笔记、标注、TTS、TOC 和阅读位置行为。
- 不重新引入 PDF 支持；历史 PDF 继续显示 unsupported 状态并可安全删除。

## 验收

- 新增或修改的视觉值全部来自 `src/styles/tokens.css`。
- Library、Reader、TOC、ToolPanel 和 AI 面板在 light/dark、阅读主题、窄窗口和 200% 缩放下保持层级、对齐和分组清晰。
- 交互控件具备键盘、ARIA、focus、disabled、loading 和 error 状态。
- `npm run check:styles`、`npm run build`、`npm run test:ui`、相关单元测试和 `npm run test:tdd:gate` 通过。

## 取舍

优先改造信息层级和组件规则，不进行一次性视觉重写；保留现有组件 API 和事件命名，以便每个工作包可独立回滚。
