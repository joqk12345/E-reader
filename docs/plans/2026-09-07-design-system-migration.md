# E-reader 设计系统迁移计划

依据：[ADR 0001](../adr/0001-design-tokens-and-ui-boundaries.md)。

## 工作方式

从 main 当前提交创建 refactor/design-tokens 分支和独立 worktree。现有主工作区的 Rust 未提交修改不带入、不覆盖；已有 reader-refactor worktree 不复用。每阶段独立可审查，避免将样式替换与复杂逻辑改写混在一起。

## 阶段及交付

- [x] P0：检查现状、记录 ADR 和迁移范围。
- [x] P1：建立应用语义颜色 tokens、Tailwind 映射、公共设置控件入口；迁移 SettingsUI；增加已迁移边界的样式检查；运行生产构建。
- [ ] P2：统一 Button/IconButton/Input/Select/Dialog/Tabs 的状态与尺寸，迁移 Settings 和 AiProfilesPanel；验证焦点、键盘、禁用及保存行为。
- [ ] P3：迁移 Library、DocumentCard、标签/确认弹窗；提取书库筛选、导入与侧栏职责；验证导入、搜索、标签和打开文档。
- [ ] P4：迁移 Reader 工具栏与工具面板，定义应用主题边界；验证调整面板宽度、菜单与面板切换。
- [ ] P5：扩展五种阅读主题的语义 tokens，集中代码、译文、批注与搜索高亮规则；迁移 ReaderContent/PdfParsedFlow/BilingualView；保留动态阅读设置与持久化兼容。
- [ ] P6：独立拆分阅读渲染、选区批注、翻译展示和阅读设置 hooks；按业务归档 features；删除确认无引用的旧样式。
- [ ] P7：扩大样式检查到整个 src；完成五主题、单/双栏、字号/行距/栏宽、EPUB/PDF/Markdown 与主要工具流程的回归。

## 第一批验收

1. tokens 在全局样式入口加载，Tailwind 语义颜色支持透明度修饰符。
2. SettingsUI 保持原有导出接口，其实现通过公共控件复用。
3. 试点无直接 Tailwind 调色板类和原始色值；任意字号改为集中定义的命名尺度。
4. npm run check:styles 与 npm run build 通过。
5. 设置页视觉和交互需在可用的 Tauri 环境中验证；构建通过不等于视觉验收。

## 回滚与完成定义

每阶段保留兼容接口，按阶段撤销即可回滚；不修改已有设置存储格式。仅在全部阶段验收后称为全量完成。待迁移文件不通过宽泛豁免伪装成完成。

## 执行记录

- P0：已检查现有主题、全局 CSS、Tailwind 配置、设置控件及主要大组件。

- P1：已实现 src/styles/tokens.css 和 Tailwind 语义映射；SettingsUI 完成试点迁移，ToggleSwitch 移入 components/ui 并保留旧路径导出。
- 设计语言修订：参考 Claude 公开页面的内容优先和低噪声原则，将设置模态框改为温暖中性色画布、纸张式层级、窄侧栏和珊瑚色强调；不复制 Claude 的品牌资产。
- 修复试点使用的未定义开关尺寸和禁用透明度。开关尺寸使用专用名称，避免影响旧页面中同名的 4.5 尺度类。
- 已运行：npm run check:styles、npm run build、git diff --check；已检查生产 CSS 包含 tokens 和语义类、开关尺寸及设置行布局。
- check:styles 已接入 CI，目前仅覆盖 SettingsUI 和 components/ui；这是逐步迁移的防回退检查，不是全项目覆盖率证明，也不是完整 CSS 解析器。
- 构建使用主工作区现有 node_modules 的父目录解析；未变更依赖。现有构建仍提示 Browserslist 数据、onnxruntime eval 和包体积警告。
- 待验收：真实 Tauri 设置页的视觉、开关交互和键盘行为；尚未完成全量迁移，P2–P7 保持待办。
- V2 迁移进度：应用内 45 个样式文件已通过语义 token 检查，所有直接 Tailwind 调色板类已清零；Library、Reader、PDF/Markdown、双语、AI 工具和设置子页均完成颜色层迁移。
- P2 进展：新增 `components/ui/Button.tsx`，ConfirmDialog、TagNameDialog、SettingsUI 的 SecondaryActionButton 已复用 Button；其余输入/选择器/标签页仍待提取。
- P2 继续：新增 `Dialog`、`Input`、`Select`、`Tabs` 基础组件；Settings 与 AiProfilesPanel 的原生输入/选择控件已统一接入 Input/Select，首页工作区导航已接入 Tabs。
- P5 进展：ReaderContent 的代码高亮与正文辅助色已收敛到 `readerTheme.ts` 的 `ReaderSyntaxTokens`，五种阅读主题保留原设置存储兼容性。
- P6 进展：Reader 的动态阅读设置持久化已抽到 `features/reader/useReaderViewSettings`；Library 的导入与筛选/分组计算分别抽到 `features/library/useLibraryImport` 和 `useLibraryDocumentFilters`，页面组件只保留组合和展示职责。
- P7 进展：`check:styles` 已扩大到整个 `src` 的 45 个应用文件；构建和样式检查已通过。Tauri 运行时流程和页面视觉仍需实机回归。
- 2026-09-08 验收记录：`check:styles` 当前覆盖 50 个应用文件（包括全部 Settings、Library、Reader、工具面板和 UI primitives）；无直接调色板类或未登记 raw color 命中。`npm run build` 通过，Vite 开发服务器返回 HTTP 200。
- 2026-09-08 仍未宣称完成：Reader 的渲染/选区/翻译 hooks 拆分，以及真实 Tauri 下五种主题和 EPUB/PDF/Markdown 交互回归仍在待办；Library 的筛选/导入职责已完成首轮拆分。
