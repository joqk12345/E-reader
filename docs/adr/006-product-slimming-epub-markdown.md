# ADR-006：产品精简，聚焦 EPUB 与 Markdown

- 状态：**Accepted**
- 日期：2026-09-11
- 目标版本：0.5.3
- 范围：产品能力、导入流程、阅读入口、测试与发布文档

## 背景

Reader 当前同时支持 EPUB、Markdown 和 PDF。实际使用中 PDF 使用率低，却带来了独立的解析器、阅读分支、页面预览、依赖、命令、测试 fixture 和维护成本。继续维护“大而全”的格式矩阵会分散 EPUB 阅读内核、Markdown 阅读体验和阅读辅助能力的投入。

Reader 的产品定位应优先服务稳定、可追溯的 EPUB 深度阅读，以及轻量的 Markdown 阅读，而不是覆盖所有文档格式。

## 决策

从 0.5.3 开始，Reader 产品支持范围收敛为：

- **EPUB**：主阅读格式，保留安全导入、资源、TOC、Locator、阅读位置、搜索、翻译、AI、笔记、标注和 TTS；
- **Markdown**：保留本地导入、结构化渲染、搜索、AI、笔记、标注和 TTS；
- **PDF**：移除产品 Feature，不再提供导入、解析、阅读、预览或新的 PDF 工作流。

这不是数据库破坏性迁移：历史 PDF document 行和原始文件不删除、不覆盖、不转换。打开历史 PDF 记录时，应用显示明确的“不再支持 PDF”状态，并允许删除记录；不得将其送入 EPUB/Markdown 阅读流程。

## 删除范围

0.5.3 应移除：

- PDF React 阅读分支、页面预览和 PDF 专用 UI；
- PDF 导入、解析、Tauri command、command 注册和 adapter；
- PDF 专用依赖、测试、fixture、smoke mock 和测试文案；
- PDF 格式筛选、快捷入口、设置项、帮助文档和发布说明中的支持承诺。

允许保留的最小兼容边界：历史记录识别、不可支持提示、删除操作，以及防止旧 PDF 记录导致崩溃的数据库读取兼容逻辑。不得保留可重新打开 PDF 的隐式路径。

## 保留范围

以下能力必须保持可用且不改变既有合同：

- EPUB/Markdown 导入、阅读、TOC 和阅读位置；
- EPUB 安全边界、sanitized render view、资源隔离和 Locator V1；
- 搜索、翻译、摘要、理解、聊天、词典、TTS、笔记、标注和主题设置；
- 现有数据库 migration、V2 publication schema 和旧数据回滚策略。

## 非目标

- 不重写 EPUB parser、sanitizer、foliate adapter 或 Locator；
- 不改变数据库 schema 或删除历史 PDF 数据；
- 不新增云同步、格式转换或自动迁移；
- 不趁机重构 AI 业务逻辑和无关 UI。

## 兼容与回滚

- 删除 PDF Feature 前先完成代码、依赖、command、数据库字段、测试、fixture、文档和 UI 入口盘点；
- feature flag 或提交级回滚应能恢复 PDF 代码，但 0.5.3 默认不暴露 PDF 入口；
- 历史 PDF 仅显示 unsupported 状态，原始路径保持只读引用，删除 document 时遵循现有删除语义；
- 若 EPUB/Markdown 流程出现回归，优先回滚 PDF 删除提交，不修改 publication 数据。

## 验收条件

- PDF 不出现在导入选项、格式筛选、快捷入口和新的阅读路由中；
- 历史 PDF 记录可安全加载并显示“不再支持 PDF”，不会触发解析或阅读崩溃；
- EPUB 和 Markdown 导入、阅读、TOC、位置、搜索、AI、笔记、标注和 TTS 回归通过；
- 代码、依赖、测试、fixture 和文档不存在无意的 PDF 残留；
- `check:styles`、`check:boundaries`、build、UI smoke、前端覆盖率、Rust tests、TDD gate 和 `git diff --check` 全部通过。

## 证据限制

本 ADR 只决定产品范围和兼容策略。PDF 使用率、代码体积和依赖减少量须在实施前后通过盘点或构建产物对比记录，不以主观估计替代证据。
