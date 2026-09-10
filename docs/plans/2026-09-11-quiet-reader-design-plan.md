# Quiet Reader 页面改造计划

- 状态：**Active / implementation in progress**
- 日期：2026-09-11
- 依据：[`ADR-005`](../adr/005-quiet-reader-visual-direction.md)
- 参考：[`paper-one`](https://github.com/xiaolai/paper-one)
- 范围：Reader 阅读壳与 AI 辅助界面；不改内容解析、数据库和 Locator 合同

## 目标

把 Reader 从“多工具并列的工作台”调整为“正文优先、工具按需出现”的安静阅读器，同时保留现有 AI、搜索、翻译、TTS、笔记和标注能力。

## 设计基线

- 正文：独立阅读主题、稳定阅读宽度、舒适行距和清晰章节层级。
- 应用壳：中性色语义 tokens、低对比边框、单一行动色和统一控件状态。
- 工具：少量高频入口常驻，高级工具通过工具轨道/面板展开。
- AI：统一上下文标识、内容卡片、Markdown 层级和低权重动作区。
- 交互：选区是 Explain、Translate、Dict、Notes 的主要入口；键盘路径与焦点恢复必须完整。

## 当前进度（2026-09-11）

- [x] WI-01：默认正文优先、工具面板默认收起、阅读模式状态保留。
- [~] WI-02：顶部工具默认收敛，当前书名显示并限制窄窗口溢出；完整响应式验收待完成。
- [~] WI-03：工具入口改为垂直轨道，TOC 与工具展开互斥；分组和窄屏细节待完成。
- [~] WI-04：选区操作增加明确的 dialog、动作和关闭语义；焦点恢复回归待完成。
- [~] WI-05：AI 卡片和错误/空状态基础样式统一；逐面板视觉一致性待完成。
- [~] WI-06：应用/阅读主题边界增加显式标记，样式 token 检查通过；完整主题隔离待人工验收。
- [~] WI-07：已覆盖 1024px smoke；200% 缩放、主题矩阵和焦点回归仍需人工验收。

自动化证据：`npm run build`、`npm run check:styles`、`npm run test:ui`、`npm run test:tdd:gate` 已通过。

## 工作包

### WI-01：Quiet Reader 默认布局

范围：`useReaderPanelLayout`、`Reader.tsx`、TOC/工具折叠入口。

验收标准：

- 新打开阅读页默认以正文为主，TOC 和工具面板不同时展开；
- 展开/收起入口有稳定的 `aria-label`、`aria-expanded` 和 tooltip/title；
- 现有阅读模式可以保存并恢复用户在当前会话中的面板选择；
- 不改变翻页、阅读位置、翻译模式和来源链接行为。

非目标：本工作包不修改 EPUB/PDF/Markdown 内容渲染。

### WI-02：顶部 Chrome 收敛

范围：`Reader.tsx`、共享 `Button`/`IconButton`。

验收标准：

- 顶部按“返回 / 书名 / 阅读设置 / 更多”建立稳定对齐关系；
- 翻译、主题、来源链接和注释等操作不再以同等权重堆叠；
- 普通、窄窗口、沉浸式阅读三种状态均无标题遮挡或按钮溢出；
- 所有尺寸、字距、颜色和阴影从 tokens 消费。

### WI-03：工具轨道与工具分组

范围：`ToolPanel.tsx`、`TOCPanel.tsx`、工具面板公共样式。

验收标准：

- 12 个工具不再以密集的 3 列文字网格作为唯一入口；
- 高频工具（Search、Understand、Notes、Translate、Dict）可快速发现；
- 低频工具（Deep、Chat、Glossary、Tags、Marks、Audio）仍可访问但不抢占正文；
- 轨道/面板在 1024px 宽度和 200% 缩放下可用，选中态、hover、focus、disabled 一致。

建议实现顺序：先保留现有 Tab API，改为窄轨道 + 可访问 tooltip；确认稳定后再考虑分组或命令面板。

### WI-04：选区 Quick Actions

范围：`ReaderContent.tsx` 选区菜单、`ToolPanel.tsx` 事件入口。

验收标准：

- 选中文本后可直接触发 Explain、Translate、Dict、Take Notes；
- 操作条定位不会遮挡选区，滚动和窗口边界变化时能重新定位或安全收起；
- 触发 AI 面板后保留选区、句子、段落和文档上下文；
- 键盘和屏幕阅读器可访问每个动作，关闭后焦点回到合理位置。

### WI-05：AI 内容卡片统一

范围：`ChatPanel.tsx`、`UnderstandPanel.tsx`、`DeepAnalysisPanel.tsx`、`SummaryPanel.tsx`、共享 Markdown 样式。

验收标准：

- 标题、段落、列表、引用、代码和链接在所有 AI 面板中统一；
- 结果卡片明确显示“回答对象/上下文”，复制、加入笔记等动作保持一致；
- 解析失败、服务不可用、生成中和空状态具有不同且可理解的视觉层级；
- 长答案在窄面板中可换行、可滚动，不出现横向溢出。

### WI-06：阅读排版与主题边界

范围：`readerTheme.ts`、`ReaderContent.tsx`、应用 tokens。

验收标准：

- 正文 serif/阅读排版与应用 sans-serif/控件排版职责分离；
- White、Paper、Mint、Sepia、Night 五种阅读主题不被应用主题覆盖；
- 应用 light/dark 主题下工具壳、AI 卡片、错误态和焦点态均有足够对比度；
- 新增设计值不直接写入组件 className 或 inline style。

### WI-07：真实窗口与响应式回归

范围：Tauri 运行时验证、UI smoke 扩展、必要的组件/边界测试。

验收标准：

- 真实 Tauri 窗口验证默认布局、展开/收起、工具切换和选区动作；
- 覆盖 1024px、1280px、1440px 及 200% UI 缩放；
- 覆盖应用 light/dark、阅读 White/Sepia/Night 至少三组组合；
- 完成 `npm run check:styles`、`npm run build`、`npm run test:ui`、相关 Rust/前端测试和 `git diff --check`。

## 实施顺序

1. WI-01：先确定默认布局和折叠状态；
2. WI-02 + WI-03：收敛顶部 Chrome 与工具入口；
3. WI-04：接入选区 Quick Actions；
4. WI-05：统一 AI 输出表面；
5. WI-06：补齐主题和 token 边界；
6. WI-07：真实窗口回归和最终 gate。

每个工作包保持小 diff，先补可观察验收，再实现；不要把阅读布局、AI 逻辑和内容引擎改造放在同一个工作包。

## 回滚策略

- 每个工作包独立提交，优先通过撤销布局/样式层回滚，不触碰文档数据和阅读位置。
- 保留现有 ToolPanel 事件名称和 Button 接口，确保视觉改造失败时可以恢复旧布局。
- 若选区浮动操作在真实 WebView 中不稳定，暂时保留现有面板入口，不影响阅读和 AI 主流程。

## 完成定义

- ADR-005 的验收条件全部满足；
- 真实 Tauri 窗口完成视觉与交互回归；
- 样式检查和构建 gate 对 exact working tree 通过；
- 计划中每个 WI 都有对应实现、测试或明确的实机验收记录。
