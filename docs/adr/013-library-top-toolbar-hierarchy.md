# ADR-013：Library 顶部工具栏层级与任务分组

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Library 顶部标题、搜索、视图切换、状态信息、导入和管理操作
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007、ADR-010、ADR-011、ADR-012

## 背景

当前 Library 顶部将页面标题、搜索框、索引状态、标签同步状态、显示选项、Batch Tags、Tag Library 和 Import 放在同一工具栏中。它们分别属于页面身份、发现、状态、视图、管理和创建任务，却拥有接近的视觉权重，导致顶部显得拥挤且主动作不明确。

## 决策

1. Library 顶部采用两层结构：
   - 第一层：页面标题、副标题和主要创建动作。
   - 第二层：搜索、文档数量、视图切换和低频选项。
2. `Import document` 是顶部唯一的主要 action，并放在标题区域右侧。
3. 搜索框作为发现任务的主要输入，保持稳定且明确的内容边界。
4. List、Grid、Compact 作为高频视图控制直接可见；排序、分组和类型筛选继续放入 Display Options。
5. Batch Tags 和 Tag Library 属于管理任务，移入 More 或管理菜单；只有进入批量选择状态时显示上下文操作栏。
6. Indexing、Tags syncing 和文档数量属于辅助状态，使用低对比度并靠近搜索/结果区域。
7. 标题、搜索框、结果列表和工具栏使用同一容器对齐线。
8. 不改变导入、搜索、视图切换、排序、筛选、批量标签或标签管理行为。

## 推荐结构

```text
Library                                      [Import document]
Your collection

[ Search your collection... ]   17 documents   [List] [Grid] [Compact] [More]
```

低频选项：

```text
More
  Sort by
  Group by category
  Filter by type
  Batch Tags
  Tag Library
```

批量选择状态：

```text
3 documents selected       [Apply tags] [Remove tags] [Cancel]
```

## CRAP 转译

- **Contrast**：Import document 是唯一主要 action；标题和搜索是主要内容，管理操作降低对比度。
- **Repetition**：标题、副标题、搜索、视图按钮和状态信息复用统一 token 与控件规则。
- **Alignment**：顶部两层、搜索、结果数量和文档列表使用同一左右边界。
- **Proximity**：搜索与结果靠近，导入与页面身份靠近，批量标签与批量选择状态靠近。

## 后果

### 正面

- 用户能快速识别当前页面和主要下一步。
- 搜索、视图切换和导入路径更容易发现。
- 管理功能不再持续占据顶部视觉空间。
- 顶部在窄窗口下更容易换行或收缩而不溢出。

### 代价

- Batch Tags 和 Tag Library 需要额外一次菜单操作。
- 顶部需要维护两层布局和批量选择上下文状态。
- UI smoke 需要覆盖 Import、Search、View mode、More 菜单和批量管理入口。

## 非目标

- 不删除 Import、Batch Tags、Tag Library、Display Options 或搜索能力。
- 不修改文档筛选、排序、视图、导入或标签管理语义。
- 不改变 EPUB/Markdown 阅读、搜索、Locator、publication、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- 顶部明确展示 Library 身份和唯一主要 Import document 动作。
- 搜索和视图控制具有清晰的发现路径。
- Batch Tags 和 Tag Library 不与主要 action 同级抢占视觉权重。
- 状态信息使用辅助对比度，不造成标题或搜索错位。
- 1024px、1280px、1440px 和 200% 缩放下无横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
