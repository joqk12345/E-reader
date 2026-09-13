# ADR-014：首页与 Library 标题层级

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：App 全局顶部导航、Library 页面标题区和首页首屏垂直层级
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007、ADR-010、ADR-013

## 背景

当前首页连续出现两套顶部身份信息：App 顶部的 `Reader / Your reading desk`，以及 Library 区域的 `Library / Your collection`。两者都使用标题、辅助文字、背景和边框，导致两个 header 互相竞争，搜索、Continue reading 和文档内容被推向更低位置。

`Your collection` 主要是装饰性副标题，没有提供文档数量、筛选状态或下一步操作等任务信息。

## 决策

1. App 顶部只负责全局品牌和工作区导航：Reader、Library、Semantic Search、Preferences。
2. App 顶部删除 `Your reading desk`，并采用更紧凑的全局导航高度。
3. Library 内容区保留唯一的内容标题 `Library`。
4. Library 删除装饰性的 `YOUR COLLECTION / Your collection` 副标题。
5. Library 标题区只显示有任务价值的辅助信息，例如文档数量、当前筛选状态或同步状态。
6. Library 顶部继续采用两层任务结构：
   - 页面身份和主要 Import document 动作。
   - 搜索、结果状态、视图控制和 More 操作。
7. App header、Library toolbar、搜索框、Continue reading 和文档列表使用统一内容对齐边界。
8. Continue reading 紧接 Library toolbar 展示，成为首页首屏主要内容。
9. 不改变全局导航、Library、导入、搜索、视图切换、筛选或文档打开行为。

## 推荐结构

```text
Reader             Library  Search       ⚙
────────────────────────────────────────
Library                              [Import]
17 documents
[ Search your collection... ]       [List] [⋯]
────────────────────────────────────────
Continue reading
[ document ]
```

如果存在筛选，应优先显示任务信息：

```text
Library
Showing EPUB · Favorites
```

而不是装饰性副标题。

## CRAP 转译

- **Contrast**：全局导航低而稳定，Library 是唯一内容主标题，Import 是主要 action。
- **Repetition**：不重复使用 Reader、Library 和 collection 身份标题。
- **Alignment**：全局 header、Library toolbar、搜索、Continue reading 和文档列表共用内容边界。
- **Proximity**：Library 标题靠近搜索和 Import；Continue reading 紧接工具栏；全局身份远离内容任务。

## 后果

### 正面

- 首屏垂直空间更多地用于搜索、继续阅读和文档内容。
- 用户能清楚区分全局导航与当前页面任务。
- 页面标题下的辅助信息更有实际价值。
- 顶部在窄窗口和高缩放下更容易保持稳定。

### 代价

- 需要重新调整 App header 与 Library toolbar 的视觉高度。
- 需要决定文档数量、筛选状态和同步状态的显示优先级。
- 旧的 `Your reading desk` 和 `Your collection` 视觉文案不再展示。

## 非目标

- 不删除 Reader 品牌、Library、Semantic Search 或 Preferences。
- 不修改导入、搜索、筛选、视图、文档打开或 Continue reading 行为。
- 不修改 EPUB/Markdown 阅读、Locator、publication、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- 首页不再连续显示两套重复的身份副标题。
- App header 和 Library 内容区职责清晰。
- Library 标题、搜索、Import 和 Continue reading 具有清晰垂直层级。
- 文档数量或筛选状态替代无任务价值的装饰性副标题。
- 1024px、1280px、1440px 和 200% 缩放下无横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
