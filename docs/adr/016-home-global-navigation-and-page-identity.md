# ADR-016：首页顶部身份与全局导航职责

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：App 首页、Library、Semantic Search、Reader 的全局导航与页面顶部身份
- 依据：Apple Books Home 参考截图、The Non-Designer's Design Book 的 CRAP 原则、ADR-010、ADR-013、ADR-014、ADR-015

## 背景

当前首页顶部同时呈现 `Reader`、`Library`、`Semantic Search` 和 `Preferences`，而 Library 内容区又有页面标题和任务工具栏。产品身份、工作区导航、页面身份和页面操作被压缩到同一顶部区域，造成视觉权重接近、内容起点下移和页面身份重复。

参考截图（`pasted-image-20260912-181422.tiff`）显示的是 Apple Books Home：左侧承担产品身份与主导航，主区域顶部只表达当前页面 `Home`。本 ADR 借鉴其职责分离，不照搬 Reading Goals、大型首页看板、推荐内容或任何新业务功能。

## 决策

1. 全局导航与页面身份分离：
   - 侧栏或产品级导航回答“我可以去哪”。
   - 页面顶部回答“我现在在哪”。
   - 页面内容回答“我下一步做什么”。
2. 首页 / Library 顶部只保留一个页面身份 `Library` 和当前页面必要操作。
3. `Reader` 产品身份不在主内容顶部重复展示；保留在产品菜单、侧栏身份或窗口级身份中的一个位置即可。
4. `Semantic Search` 不与当前页面身份争夺同等级顶部权重；由侧栏、More 或 Library 内辅助入口提供可达路径，具体位置需在实现 WI 中验证。
5. `Preferences` 保持直接可达，但不为它单独增加第二个页面 header。
6. Reader 阅读页使用独立的文档级顶部栏：返回、文档标题、阅读设置和工具；不显示 Library 首页的工作区 tabs。
7. 本 ADR 不新增 Home dashboard、Reading Goals、推荐、书店或最近阅读业务模块。
8. 本 ADR 不改变 Library、Semantic Search、Reader、设置、导入、筛选、Locator、阅读位置、AI、Tauri IPC 或数据库行为合同。

## 推荐结构

### Library 首页

```text
┌──────────────┬───────────────────────────────────────────┐
│ Reader       │                         Library     [···] │
│              ├───────────────────────────────────────────┤
│ Home         │ [Search library...]              [Import] │
│              │                                           │
│ Library      │ Continue reading                          │
│ ▌All         │ [文档标题] [作者] [42%]             [继续] │
│  Recent      │                                           │
│  Favorites   │ Documents                                 │
│              │ [文档列表]                                 │
│ More         │                                           │
│  Semantic    │                                           │
│  Settings    │                                           │
└──────────────┴───────────────────────────────────────────┘
```

示意中 `Reader` 仅作为侧栏身份示例；如果当前产品不采用持久侧栏，则必须使用一个品牌标记与一个页面标题，不能同时显示产品名、工作区 tabs 和重复页面标题。

### Semantic Search

```text
侧栏：Semantic Search
主区顶部：Semantic Search
主区内容：查询 → 状态 → 结果
```

页面标题只出现一次，搜索输入和结果保持同一内容边界。索引状态和高级设置不能与查询主任务争夺主要对比度。

### Reader

```text
← Library       文档标题                 [Aa] [工具] [更多]
──────────────────────────────────────────────────────────
                         正文
```

Reader 顶部只服务于当前文档，不重复首页工作区导航。

## CRAP 转译

### Contrast

当前页面身份是顶部主要文字；当前页面的主要动作获得次一级强调；产品品牌、辅助状态和低频入口降低对比度。不要让 `Reader`、`Library`、`Semantic Search` 和 `Preferences` 看起来都是当前任务。

### Repetition

重复的是导航、标题、按钮和状态的视觉规则，而不是重复产品身份。相似页面共享 header 高度、对齐、焦点和 token；身份文案不在多个层级重复。

### Alignment

页面标题、搜索、Continue reading、结果或文档列表共享一个内容边界。侧栏边界与主内容边界清晰，不通过多层 header 和 padding 把内容继续推远。

### Proximity

页面标题靠近页面任务；搜索靠近结果；Import 靠近 Library 身份；Reader 工具靠近文档身份。全局导航不与页面任务混在同一组。

## 后果

### 正面

- 减少首页顶部冗余，提升首屏有效内容。
- 用户可以稳定区分产品身份、当前位置和当前动作。
- Library、Semantic Search 和 Reader 的顶部结构更容易响应式收缩。
- 不需要引入新的首页业务内容即可改善空间问题。

### 代价

- Semantic Search 可能需要从顶部 tab 移至侧栏或 More，必须保证可发现性。
- 如果引入侧栏，需要验证窄窗口和 200% 缩放下的折叠行为。
- Reader 与首页的顶部栏需要维护两套任务语义，而不是强行复用所有按钮。

## 实施边界

后续实施应拆为独立 WI：

1. 先测量当前顶部层级和可见内容起点。
2. 选择“持久侧栏”或“单一紧凑顶部栏”，不得两者同时叠加。
3. 只改变导航与身份层，不改业务行为。
4. 覆盖 Library、Semantic Search、Reader、Settings 的键盘、ARIA、长标题、窄窗口和 200% 缩放。
5. 真实 Tauri 原生窗口验收后，才能将本 ADR 从 Proposed 改为 Accepted。

## 非目标

- 不删除或重新实现 Semantic Search。
- 不增加 Reading Goals、书店、推荐、收藏夹或新的 Home 内容模块。
- 不重新加入 PDF 阅读支持。
- 不改变 EPUB/Markdown 阅读、搜索、Locator、publication、数据库、AI 或 Tauri IPC。

## 验收

- 首页顶部不再同时承担产品身份、工作区导航和页面身份三种职责。
- Library 页面身份只出现一次，并与 Library 任务内容对齐。
- Semantic Search 仍可发现并直接进入。
- Reader 顶部只保留文档级操作。
- 1024px、1280px、1440px、200% 缩放、键盘导航和长标题无横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
