# ADR-015：Library 与 Reader 的密度和间距节奏

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：App shell、Library、Reader Chrome、TOC、ToolPanel、DocumentCard 和内容区
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007、ADR-012、ADR-014

## 背景

Library 和 Reader 当前存在多层 header、toolbar、section、content container 和 card padding。每个局部表面单独看都合理，但多个 `padding`、`gap`、`margin` 叠加后，整体出现过多结构留白，页面显得松散，内容和操作被推远。

问题不是需要消灭留白，而是需要区分结构留白、内容留白和操作留白，并用统一节奏表达层级。

## 决策

1. 结构留白、内容留白和操作留白分别管理，不进行全局无差别压缩。
2. 结构间距收敛为三档：紧密 4–8px、普通 12–16px、区块 20–24px。
3. App header、Library toolbar、Reader Chrome 和侧栏 header 使用紧凑且一致的高度。
4. Library content area 默认使用约 16px padding；Continue reading、文档列表和卡片之间使用统一 section rhythm。
5. Reader 正文保留阅读所需的行高、段落间距和内容宽度；减少主要来自 header、toolbar 和侧栏的结构留白。
6. TOC、ToolPanel header 和 tab 采用紧凑的垂直 padding，但不降低可操作控件的最小点击区域。
7. DocumentCard 的 padding 根据 Grid、List、Compact 视图分别 token 化，但三种模式共享同一信息层级。
8. 同一层级不重复叠加页面 padding、section padding 和 card padding；每个间距必须承担明确的分组或可读性职责。
9. 所有新增或修改的间距、控件高度、圆角和阴影继续使用命名 tokens。

## 推荐节奏

```text
App header：48–52px
Library / Reader toolbar：上下 12px
Content area：16px
Section gap：16–20px
List card gap：8px
Grid card gap：12px
Compact card gap：4px
Panel header：上下 10–12px
Panel tab：上下 6–8px
```

## CRAP 转译

- **Contrast**：用间距差异突出区块层级，而不是让所有区域都使用大留白。
- **Repetition**：Library、Reader、侧栏和卡片复用同一组 spacing tokens 与节奏。
- **Alignment**：页面、toolbar、内容和卡片遵循单一容器边界，避免嵌套 padding 造成错位。
- **Proximity**：标题、搜索、Continue reading、文档列表和工具内容保持任务上的近邻关系。

## 后果

### 正面

- Library 和 Reader 的首屏有效内容增加。
- 页面层级更紧凑但不牺牲正文阅读舒适度。
- 不同组件的空间感更一致，减少“每个组件各自舒服”的叠加。
- 窄窗口和 200% 缩放下内容区域获得更多空间。

### 代价

- 需要审查现有局部 padding、margin 和 gap，避免只修改单个组件。
- 需要分别验证正文可读性、操作目标、卡片密度和侧栏可用性。
- 不同视图模式的密度目标需要持续维护。

## 非目标

- 不移除正文所需的行高、段落间距或阅读宽度。
- 不降低按钮、tab、输入框和图标操作的可访问点击区域。
- 不改变 Library、Reader、搜索、导入、筛选、AI、Locator、数据库或 Tauri IPC 行为。
- 不重新加入 PDF 阅读支持。

## 验收

- Library 和 Reader 不存在重复的大面积 header 间距。
- 结构间距符合紧密、普通、区块三档节奏。
- Grid、List、Compact 的卡片密度清晰且可区分。
- Reader 正文的行高和段落可读性保持不变。
- 1024px、1280px、1440px 和 200% 缩放下无横向溢出。
- `npm run check:styles`、`npm run test:ui`、相关单元测试和 `npm run test:tdd:gate` 通过。
