# Reader Robin Williams 设计原则重构计划

- 状态：In progress
- 日期：2026-09-12
- 依据：[`Robin Williams 设计原则`](../design/robin-williams-design-principles.md)
- 范围：Reader chrome、TOC、Tools、阅读排版、菜单可访问性

## 目标

让阅读正文成为 Reader 唯一主要视觉焦点，以 Contrast、Repetition、Alignment、Proximity 和明确的字体关系降低周边 UI 噪音，同时保持 EPUB/Markdown 阅读及全部工具行为不变。

## 不变量

- 不改变 publication、Locator、章节选择、阅读位置、翻页、搜索、翻译、AI、笔记、标注和 TTS 合同。
- 不修改数据库、Tauri IPC、EPUB 安全边界或阅读内容数据。
- 不移除任何现有工具；低频工具只能渐进披露。
- 用户字号、行高、内容宽度、主题、单双栏和双语设置继续生效。
- 新增或修改的视觉值必须来自 `src/styles/tokens.css`，阅读内容 token 与应用壳 token 分离。

## WI-RT-01：Reader chrome 降噪

状态：Implemented and covered by UI smoke.

### 验收

- 非沉浸模式顶部只保留返回、当前文档身份、View 和必要的文档操作。
- 不重复显示 Reader 品牌图标。
- Translation 和解析/双语显示设置归入 View 菜单。
- Word Stats 不再形成常驻底部工具栏，在 View 中保持可发现。
- 长标题截断和返回行为不变。

### 非目标

不改变翻译状态机、解析模式和统计计算。

## WI-RT-02：TOC 折叠态

状态：Implemented and covered by UI smoke.

### 验收

- 折叠态只显示展开入口，不显示无法可靠识别章节的首字母列表。
- 展开态保留全部章节、当前章节状态、选择和 resize 行为。
- 打开 Tools 时 TOC/Tools 互斥行为不变。

## WI-RT-03：Tools 主次层级

状态：Implemented and covered by unit/UI tests.

### 验收

- 首层只保留 Search、Understand、Chat 三个高频任务。
- Summary、Dict、Translate、Deep、Glossary、Tags、Notes、Marks、Audio 全部保留在 More tools。
- 展开态不使用彩色 emoji 制造竞争；当前 tab 仍有明确状态。
- 折叠态只保留展开 Tools 的入口，不形成第二条工具图标导航。
- 工具事件、请求和活动面板映射不变。

## WI-RT-04：阅读字体角色

状态：Implemented and covered by rendered Markdown H1–H6, body, quote and code smoke assertions; translation and EPUB typography remain follow-up evidence.

### 验收

- Markdown H1–H6、正文、翻译、引用、代码和图注使用阅读语义角色。
- 不再借用应用壳页面标题 token 表达文章标题。
- 删除组件内一次性的字体家族和固定阅读行高。
- 用户阅读设置仍是最终字号、行高和内容宽度来源。

## WI-RT-05：Reader 菜单一致性

状态：View and source-action menus implemented; focus, Escape, directional keyboard, outside-focus and Copy/Open action contracts covered by UI smoke.

### 验收

- View 与文档操作菜单具有 `aria-expanded`、`aria-controls`、menu/menuitem 语义。
- 支持二次点击、点击外部、Escape、打开后首项聚焦和关闭后焦点恢复。
- 菜单互斥，窄窗口和 resize 后不会使用错误锚点。

## WI-RT-06：验收

状态：Automated verification complete; native Tauri and real-document visual evidence pending.

- UI smoke 覆盖 chrome、TOC、Tools、菜单键盘交互和无常驻 stats bar。
- `npm run test:unit`、`npm run test:ui`、`npm run check:styles`、`npm run build`、Rust tests 和 exact-tree TDD gate 通过。
- 人工补验真实 EPUB/Markdown、1024/1280/1440px、200% 缩放、长标题和原生 Tauri 窗口。

## 实施顺序

1. RT-01 至 RT-03 先完成结构层级；
2. RT-04 在结构稳定后收敛字体角色；
3. RT-05 统一菜单交互；
4. RT-06 完成自动门禁并记录仍需人工验证的证据。

## 完成定义

正文在默认状态下占据最大面积和最高内容对比；TOC、Tools、状态和设置均按需出现；所有原有任务仍可发现并保持行为合同；自动质量门禁通过，未完成的原生视觉验证不得标记为完成。

## 实施记录

- Reader header 删除重复产品 logo、常驻 Translation 控件和 More/Less；View 统一承载翻译、解析、双语模式及完整统计。
- 顶部 Tools 入口显式反映右侧工具面板展开状态；遗留 `headerToolsCollapsed` 状态已删除，旧快捷事件改为打开 View。
- 常驻 Word Stats footer 已移除。
- TOC 折叠态不再渲染章节首字母导航。
- Tools 首层收敛为 Search、Understand、Chat；其他工具保留在 More tools。
- 展开和折叠工具区不再使用彩色 emoji 导航。
- Markdown H1–H6 和正文改用协调的阅读字体角色，与 App Shell 字体形成结构对比；字号、字重和行高来自独立 tokens，并包含 macOS/CJK serif fallback 链。
- View 与来源菜单加入 menu 语义、互斥、Escape、首项聚焦、方向键导航和焦点返回。
- 选区事件打开 Notes、Translate、Marks、Dict 或 Glossary 时会同步展开 More tools，避免活动工具身份被隐藏。
- Markdown 章节点击不会用单章节请求覆盖全文段落；Reader 的全文加载 effect 负责提供跨章节内容，避免破坏全文状态。
- 自动测试完成后仍需使用真实 EPUB/Markdown 和原生 Tauri 窗口完成视觉验收；当前 smoke 已覆盖 1024px 横向溢出检查，但不等同于 200% 缩放验收。
