# ADR-010：首页工作台信息架构与任务优先级

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：未打开文档时的首页、顶部导航、Library 首页和 Semantic Search 入口
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-005、ADR-007、ADR-008、ADR-009

## 背景

打开 Reader 后，首页顶部同时呈现品牌、Library、Semantic Search、Preferences 和 Library 内容。多个入口具有接近的视觉权重，但用户进入应用后的主要任务通常是继续阅读或找到一本书，而不是立即使用高级搜索或设置功能。

首页需要从“功能入口集合”转为“继续阅读与发现内容的工作台”。

## 决策

首页采用“继续阅读优先、发现内容其次、高级功能渐进披露”的信息架构：

1. 顶部保留简洁品牌、当前工作区导航和设置入口。
2. Library 作为默认主工作区；Semantic Search 降为辅助导航或高级入口。
3. 主内容使用统一容器边界，标题、搜索框、继续阅读和文档网格保持同一对齐线。
4. 有阅读记录时，首页优先展示 Continue reading，包括文档、进度和 Continue 动作。
5. 没有阅读记录时，展示单一明确的空状态和 Import document 主动作。
6. Library 搜索是发现任务的主要入口；筛选器保持在侧栏并遵循 ADR-008 的渐进披露规则。
7. Import、Semantic Search、Tag 管理和 Preferences 不与 Continue reading 竞争主要视觉权重。
8. 顶部只允许一个明确的 active workspace 状态；普通导航保持低对比度。
9. Preferences 使用紧凑但可访问的图标入口，必须保留 aria-label。
10. 不改变文档导入、打开、搜索、阅读位置、Semantic Search 或设置功能合同。

## CRAP 转译

- **Contrast**：Continue reading 或 Import document 是首页唯一主要行动；高级功能降低对比度。
- **Repetition**：品牌、导航、设置和页面操作复用统一的 Button、Tabs、Input 和 tokenized surface。
- **Alignment**：顶部导航、页面标题、搜索框、继续阅读卡片和文档网格共用同一内容容器。
- **Proximity**：继续阅读靠近首页标题；搜索靠近文档集合；设置和高级功能远离主要阅读路径。

## 推荐层级

```text
Reader / workspace navigation

Library
  Your collection
  Search your library
  Continue reading
  Document collection

Secondary actions
  Import document
  Semantic Search
  Preferences
```

## 空状态

空 Library 只提供一个主要下一步：

```text
Your library is empty
Import your first EPUB or Markdown document
[Import document]
```

不在空状态同时展示多个竞争性操作。

## 后果

### 正面

- 用户进入应用后能立即理解当前工作区和下一步动作。
- 继续阅读路径比高级功能更短。
- 首页视觉噪音降低，正文和文档内容获得更高权重。
- 统一容器边界改善不同窗口宽度和缩放比例下的稳定性。

### 代价

- Semantic Search 和其他低频入口需要额外一次导航或点击。
- 需要维护 Continue reading、空状态和无历史记录三种首页内容状态。
- UI smoke 需要覆盖首页导航、继续阅读、空状态和设置入口。

## 非目标

- 不删除 Semantic Search、Preferences、Import 或 Library 功能。
- 不修改 EPUB/Markdown 阅读、搜索、Locator、publication、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- 首页默认主任务是继续阅读或导入首个文档。
- 顶部只存在一个清晰的 workspace active 状态。
- Library、标题、搜索和内容网格使用统一对齐容器。
- 高级入口不会抢占 Continue reading 或 Import 的主要视觉权重。
- 空 Library 显示单一明确的 Import 主动作。
- `npm run test:ui`、`npm run check:styles`、相关单元测试和 `npm run test:tdd:gate` 通过。
