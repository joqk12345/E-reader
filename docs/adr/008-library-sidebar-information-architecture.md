# ADR-008：Library 侧栏信息架构与渐进披露

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Library 左侧筛选栏、分类、Tags 和当前筛选摘要
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007

## 背景

Library 左侧同时展示格式、分类、收藏、最近阅读、全部文档、自定义分类、Tags 搜索、匹配模式和大量 tag 项。虽然功能完整，但所有内容具有近似的视觉权重，造成侧栏臃肿、层级不清和正文区域被压缩的问题。

问题的根因不是单纯的像素间距，而是浏览任务、格式筛选和低频高级筛选没有被区分。

## 决策

Library 侧栏采用“常用路径优先、低频条件渐进披露”的信息架构：

1. 默认只显示高频浏览入口：All、Favorites、Recent。
2. EPUB 和 Markdown 作为独立的格式筛选组，不与 Category 混为一组。
3. Category 与 Tags 归入可折叠的 More filters 区域。
4. Tags 默认不展开完整列表；只有搜索、展开或存在已选 tag 时显示详细内容。
5. 当前筛选条件显示为紧凑摘要，并提供统一的 Clear all 操作。
6. 普通筛选项保持低对比度；只有当前项使用 action 色、accent bar 或明确的 aria 状态。
7. section 标题、选项文字和数量使用统一对齐边界；数量右对齐并使用辅助对比度。
8. 侧栏默认宽度控制在约 200–220px，窄窗口优先保护正文区域。
9. 不改变现有筛选语义、数据库查询、文档类型判断或历史 PDF 的可识别性与删除能力。

## CRAP 转译

- **Contrast**：只突出当前筛选和主要浏览入口，减少无意义的背景块。
- **Repetition**：所有筛选项复用同一行高、字号、数量位置和 focus-visible 状态。
- **Alignment**：section、输入框、选项和数量使用统一容器边界。
- **Proximity**：浏览、格式和高级筛选分组；当前筛选摘要靠近结果区域。

## 后果

### 正面

- 首次进入 Library 时，用户能快速理解主要浏览路径。
- Tags 和 Category 不再占据默认视线与垂直空间。
- 窄窗口和 200% 缩放下正文获得更多空间。
- 高级筛选仍然可访问，不牺牲现有能力。

### 代价

- 低频筛选多一次展开操作。
- 需要维护折叠状态、当前筛选摘要和键盘可访问的渐进披露。
- UI smoke 需要覆盖展开、收起、筛选状态和清除操作。

## 非目标

- 不删除 Category、Tags、Favorites、Recent 或格式筛选能力。
- 不修改 EPUB/Markdown 阅读、搜索、Locator、publication、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- 默认侧栏不显示完整 Tags 列表。
- All、Favorites、Recent、EPUB、Markdown 的层级清晰且可键盘操作。
- 展开 More filters 后 Category 与 Tags 仍可完成现有筛选流程。
- 当前筛选摘要可识别并可一次性清除。
- `npm run test:ui`、`npm run check:styles`、相关单元测试和 `npm run test:tdd:gate` 通过。
