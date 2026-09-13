# ADR-017：Library 结果状态与搜索工具栏对齐

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Library 页面标题区、文档数量、搜索、视图、More 和 Import
- 依据：Library 参考截图、The Non-Designer's Design Book 的 CRAP 原则、ADR-013、ADR-014、ADR-015、ADR-016

## 背景

当前 Library 页面接近以下结构：

```text
Library
75 documents

[ Search your collection... ] [···] [More] [Import]
```

`75 documents` 实际上是当前集合的结果状态，却被放在页面身份标题下，和搜索任务分离。`Import` 是创建文档的主要动作，却与搜索、视图和 More 管理操作处于同一工具行，造成任务层级不清和顶部占用偏高。

这不是单纯的 padding 问题，而是身份、结果状态、发现任务和创建任务的分组错误。

## 决策

1. Library 顶部采用两层任务结构：
   - 第一层：页面身份 `Library` 与主要创建动作 `Import`。
   - 第二层：搜索、动态结果数量、视图和 More。
2. `75 documents`、`N matches` 或筛选结果摘要属于发现/结果组，应与搜索栏保持近邻，而不是作为 Library 的副标题。
3. `Import` 是 Library 顶部唯一主要 action，放在页面身份行右侧。
4. 搜索、结果数量、视图和 More 使用辅助或次级对比度，不与 Import 竞争。
5. Library 搜索推荐放入左侧筛选/浏览栏顶部，主内容区不再重复放置搜索输入框。
6. 左侧搜索必须保持默认可见，不能收入 More filters；它与 Formats、Browse 和筛选器形成同一查找任务组。
7. 不新增第三层 header，不重复显示 Library 身份。
8. 当前搜索、导入、筛选、排序、视图切换、批量标签和 Tag Library 的行为合同保持不变。

## 推荐结构

```text
┌──────────────┬────────────────────────────────────────────┐
│ [Search...]  │ Library · 75 documents             [Import] │
│              ├────────────────────────────────────────────┤
│ FORMATS      │ CONTINUE READING                           │
│ All      75  │ [文档标题]                         [Continue]│
│ EPUB      8  │                                            │
│ Markdown 57  │ DOCUMENTS                                  │
│              │ [文档列表]                                 │
│ BROWSE       │                                            │
│ Favorites    │                                            │
│ Recents      │                                            │
│              │                                            │
│ More filters │                                            │
└──────────────┴────────────────────────────────────────────┘
```

搜索不再占用主内容区的独立 toolbar。主区域身份和主要动作保持在同一行：

```text
Library · 75 documents                         [Import]
```

## 响应式结构

宽窗口下搜索固定在左侧栏顶部，主区域保持简洁。窄窗口或 200% 缩放时，侧栏可以变成抽屉，但搜索仍必须是抽屉打开后的第一个可见控件：

```text
[Library filters]
[Search your collection...]
```

如果产品最终采用完全折叠的侧栏，必须提供一个明确的 `Search Library` 入口或快捷键；不能让搜索只剩无标签图标，也不能同时长期显示第二个搜索框。

视图选项可以在空间不足时收进 More，但搜索不能随之被收起。

## 状态文案

`documents` 是未筛选集合的状态；有查询或筛选时，应反映当前结果：

- `75 documents`
- `3 matches`
- `Showing 8 EPUB documents`
- `No matching documents`

结果状态使用 muted token，不加卡片、不使用强标题字重，也不伪装成页面副标题。

## CRAP 转译

### Contrast

Import 是唯一主要创建动作。Library 是页面身份。结果数量、视图和 More 降为辅助层级，搜索保持清晰但不超过主要动作。

### Repetition

页面身份、结果状态和任务工具使用稳定的两层规则；不通过多个标题、副标题和 toolbar 重复表达同一集合上下文。

### Alignment

第一层的 Library 与 Import 对齐；第二层的搜索、结果数量、视图和 More 对齐；Continue reading 与文档列表共用内容边界。

### Proximity

左侧搜索、Formats、Browse 和筛选器组成查找文档的任务组；主区域的结果数量靠近 Library 身份；Import 靠近页面身份；视图与 More 靠近 Documents 标题；批量管理只在 More 或批量选择状态出现。

## 后果

### 正面

- 用户能快速区分“我在哪”“当前有多少结果”“我能做什么”。
- `75 documents` 与搜索状态语义一致。
- Import 不再被普通筛选和管理操作稀释。
- 顶部结构更容易适配 1024px、窄窗口和高缩放。
- 不需要新增首页内容或改变业务行为即可减少视觉混乱。

### 代价

- 需要处理搜索结果数量与筛选状态的动态文案。
- 需要验证两层 toolbar 在窄窗口的换行边界。
- 视图按钮在空间不足时可能需要进入 More，需保留可发现性。

## 非目标

- 不改变文档数量计算、搜索匹配、筛选、排序或视图语义。
- 不改变 Import 流程、PDF 历史记录处理或文档打开行为。
- 不新增 Home dashboard、Reading Goals、推荐或书店内容。
- 不修改 EPUB/Markdown 阅读、Locator、publication、数据库、Tauri IPC 或 AI 合同。

## 验收

- `Library` 与 `Import` 位于页面身份层。
- 文档数量与搜索栏位于同一结果工具层。
- Import 视觉权重高于 More 和普通视图操作。
- 搜索位于左侧查找任务组顶部；结果数量与 Library 页面身份对齐；视图和 More 与 Documents 结果区对齐。
- 查询、筛选、空结果和加载状态不会产生错误或重复标题层级。
- 侧栏折叠、窄窗口和 200% 缩放时搜索仍可发现、可聚焦、可操作，且不出现第二个常驻搜索框。
- 1024px、1280px、1440px、200% 缩放、长筛选文案和键盘操作无横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
