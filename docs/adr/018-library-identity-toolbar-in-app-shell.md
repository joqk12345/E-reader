# ADR-018：将 Library 身份与页面操作提升至 App Shell

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：App 首页顶部、Library 页面身份、文档数量、Import 和 More
- 依据：Library 参考截图、The Non-Designer's Design Book 的 CRAP 原则、ADR-014、ADR-016、ADR-017

## 背景

当前首页存在多层顶部身份和操作：

```text
顶部：Reader
顶部：Library / Workspace / Preferences
内容区：Library / 75 documents
内容区：More / Import
```

圈出的 `Library / 75 documents / More / Import` 位于主内容区左上角，而上方已有 `Library` 页面身份。这会造成重复标题、操作区与内容区脱节，以及主内容区顶部出现大面积无效留白。

## 决策

1. 将 `Library`、当前文档数量、`Import` 和 `More` 提升到 App Shell 的唯一 Library 页面顶部栏。
2. 删除主内容区内重复的 `Library`、文档数量和 Import/More 操作区。
3. 主内容区从 `Continue reading` 或 `Documents` 开始，不再重复表达 Library 身份。
4. 搜索继续放在左侧筛选/浏览栏顶部，主区域顶部不恢复第二个搜索框；具体规则遵循 ADR-017。
5. 顶部操作顺序优先采用：

```text
R   Library · 75 documents                    [Import] [More]
```

6. Workspace 切换和 Preferences 保持可达，但置于右侧并使用低于 Import 的视觉权重；不得再次制造第二个页面标题层。
7. 本 ADR 只调整导航、身份和页面操作的空间归属，不改变导入、搜索、筛选、排序、视图、标签或文档打开行为。

## 推荐结构

```text
┌────────────────────────────────────────────────────────────┐
│ R   Library · 75 documents              [Import] [More]     │
│                                      [Workspace ▾] [⚙]      │
├────────────────────────────────────────────────────────────┤
│ [Search your collection...]       CONTINUE READING          │
│ Formats                             [继续阅读文档]           │
│ Browse                              DOCUMENTS               │
│ More filters                        [文档列表]               │
└────────────────────────────────────────────────────────────┘
```

在能够容纳的窗口宽度下，身份和页面操作优先保持一行；在窄窗口或 200% 缩放下允许换行，但不压缩可访问点击区域：

```text
R   Library · 75 documents                         [Import]
                                                   [More]
```

如果最终保留居中的页面标题，则顶部只能有一个 `Library`，不能同时保留内容区的 `Library`。

## CRAP 转译

### Contrast

`Library` 是页面身份，`Import` 是唯一主要页面 action，`More` 是次级管理 action。Workspace 和 Preferences 不与 Import 竞争。

### Repetition

产品身份、页面身份和操作不在 App Shell 与页面内容中重复。不同工作区可以复用顶部高度、对齐线、按钮和状态 tokens，但不复制标题层。

### Alignment

顶部的产品标记、Library 身份、数量和页面操作共享一条 shell 边界；下方内容直接从 Continue reading 或 Documents 开始，与左侧搜索/筛选栏形成清楚的主次边界。

### Proximity

Library 与文档数量表达同一个集合身份；Import 和 More 靠近页面身份；搜索与 Formats、Browse、Filters 靠近；文档内容不被重复身份栏推远。

## 后果

### 正面

- 消除顶部 `Library` 与内容区 `Library` 的重复。
- 主内容区垂直起点上移，首屏显示更多文档。
- Import 的主要 action 属性更明确。
- 与 Apple Books 参考图一致地让顶部表达当前页面，而不是叠加多个身份层。

### 代价

- App Shell 需要知道当前工作区的页面身份和页面操作。
- Workspace 菜单、Preferences 和 Library 页面操作需要在窄窗口下重新布局。
- 页面进入、返回、筛选和空状态需要验证标题与结果状态的一致性。

## 非目标

- 不将 Library 与 Reader 合并为同一功能页面。
- 不把搜索移入顶部，也不新增第二个搜索框。
- 不新增 Home dashboard、Reading Goals、推荐、书店或最近阅读业务模块。
- 不改变 Library、Semantic Search、Reader、Settings、导入、筛选、Locator、阅读位置、AI、Tauri IPC 或数据库行为。
- 不重新加入 PDF 阅读支持。

## 验收

- 首页顶部只出现一个 Library 页面身份。
- `Library · N documents` 与 Import/More 在同一页面身份层。
- 主内容区不再重复 Library、数量或页面操作栏。
- 主内容从 Continue reading、Documents 或明确空状态开始。
- 搜索仍在左侧且默认可见，主内容区没有第二个常驻搜索框。
- Workspace 和 Preferences 仍可发现、可键盘操作且不抢占 Import 的主要权重。
- 1024px、1280px、1440px、200% 缩放和长标题下无横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
