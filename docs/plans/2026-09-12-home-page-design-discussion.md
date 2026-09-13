# Reader 主页面设计讨论记录

日期：2026-09-12
状态：设计讨论归档；实现以 ADR-010 至 ADR-015 和当前代码为准。

## 讨论起点

用户认为 Library 与 Reader 的空间仍然过大，希望从《The Non-Designer's Design Book》的 CRAP 原则重新审视。随后提供了一张 Apple Books（此前口头称作 iRead）的 Home 截图作为参考。

### 后续截图纠正了重点

第二张截图（`pasted-image-20260912-181422.tiff`）才是本次首页结构判断的主要证据。它显示：

- 左侧已有固定品牌和导航。
- 主区域顶部只有一个居中的 `Home` 页面身份。
- 顶部没有重复的产品名、工作区 tabs 或页面副标题。
- 最近阅读横向内容位于主区域上方，Reading Goals 才是下面的独立任务区域。

因此参考价值首先是**删除重复的顶部身份层**，而不是增加 Home 看板或复制 Reading Goals。此前将两张截图笼统称作同一首页参考，并由此提出“增加首页内容”，判断不准确，已在本记录中修正。

## 主要判断

### 顶部冗余是当前首要问题

当前应用首页顶部类似：

```text
[Reader]       [Library] [Semantic Search]       [Preferences]
```

而 Library 内容区随后又出现自己的页面标题、搜索和工具栏。对于首页来说，`Reader` 是产品身份，`Library` 是工作区身份，二者在当前实现里同时占据顶部视觉空间；`Semantic Search` 也以同等权重参与顶部导航。结果是页面内容被向下推移，且用户要在两个层级中理解“我在哪里”。

首选方向不是增加左侧栏或 Home 看板，而是：

> **首页只保留一个页面身份和一组页面操作；Reader 品牌、Library 工作区 tabs 和页面标题不要同时占据顶部。**

候选首页顶部：

```text
                         Library                 [Preferences]
```

或在已有侧栏成立时：

```text
                         Library                  [Import]
```

Semantic Search 作为 Library 内的辅助入口或 More action，不与页面身份并列争夺首屏对比度。Reader 品牌保留在产品菜单、窗口标题或侧栏身份中，但不重复出现在主区域顶部。

这仍需结合实际导航可达性选择最终方案；本记录不直接批准删除全局导航。

Library 和 Reader 不应合并为同一个功能页面：

- Library 的任务是找到、筛选、管理和选择文档。
- Reader 的任务是阅读、导航和使用理解工具。

但二者应共享紧凑的 App Shell、顶部高度、对齐规则、控件和状态样式。应合并视觉层级，不合并任务内容。

首页也不应继续增加一套独立 Home 看板。最终方向是：

> 书库就是首页；打开应用后直接看到继续阅读、搜索、导入和文档集合。

## 曾提出但被否定的方向

### 增加独立 Home 工作台

早期草案考虑过：

- Home
- Recently opened 横向卡片
- Continue reading 大卡片
- Reading Goals
- Library

自我审查后否定，原因是：

1. 当前问题是空间层级过多，增加 Home 会继续增加导航和内容层。
2. Apple Books 截图的 Reading Goals 本身占据很大面积，不能简单作为密度参考。
3. “最近阅读”和“继续阅读”容易变成重复入口。
4. 不应为了模仿参考图而引入未经需求确认的推荐、目标或看板功能。

## 最终首页结构

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Reader       │ Library                         [Import]       │
│              ├──────────────────────────────────────────────┤
│ 全部文档     │ [Search library...]       17 documents [List] │
│ 收藏         │                                              │
│ 最近打开     │ Continue reading                              │
│              │ [封面] 书名 · 作者 · 42%                 [继续] │
│ 格式         │                                              │
│ EPUB         │ Documents                                    │
│ Markdown     │ [文档列表]                                  │
│              │                                              │
│ 更多筛选     │                                              │
│              │                                              │
│ 设置         │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### 顶部

- App header 只负责品牌、工作区导航和 Preferences。
- Library 内容区只保留一个 `Library` 身份标题。
- 删除 `Your reading desk` 和 `Your collection` 等无任务价值副标题。
- Import document 是唯一主要 action。
- 搜索、结果数量、视图切换和 More 组成发现／管理工具层。

### 继续阅读

- 有阅读记录时显示一条紧凑入口，不使用大面积 dashboard 卡片。
- 显示封面、标题、作者、进度和 Continue。
- 搜索或筛选时可以让位给结果，但不得改变阅读记录或打开行为。
- 无记录时不留下空白占位；空 Library 只显示一个 Import document 主动作。

### 文档集合

- 默认使用 List，Grid 和 Compact 保留为主动选择。
- 默认扁平集合，不按 Category 分组。
- Category、Tags、Batch Tags 和 Tag Library 渐进披露。
- 文档标题优先，作者、格式、日期、分类和进度为辅助 metadata。
- 使用分隔线表达列表关系，不让每一项都成为重卡片。

## CRAP 设计结论

### Contrast

首页只保留一个主要下一步：

- 有记录：Continue reading。
- 无记录：Import document。

Semantic Search、Preferences、Tag 管理和索引状态不得与主要任务拥有相同视觉权重。

### Repetition

重复应表现为规则一致，而不是复制标题：

- App header、Library toolbar、列表和设置共享 tokens 与控件规则。
- 不重复展示 Reader 身份、Library 身份和 collection 副标题。
- 文档行、按钮、状态和面板采用稳定结构。

### Alignment

以下内容共享同一内容边界：

- Library 标题
- 搜索框
- Continue reading
- 文档数量
- 文档列表

侧栏是导航边界，正文是内容边界，不用多层 padding 把同一组内容逐层推远。

### Proximity

- Import 靠近 Library 身份。
- 搜索靠近文档集合。
- Continue reading 紧接工具栏。
- Category 与 Tags 默认远离首屏主任务，放入 More filters。
- 不把 Reader 工具放进 Library，也不把 Library 管理操作放进 Reader。

## 对空间问题的修正

空间问题不能通过把所有值从 24px 改成 16px 解决。应区分：

- 结构间距：header、toolbar、section 之间，可收紧。
- 内容间距：正文行高、段落和书籍内容，不应为了密度破坏可读性。
- 操作间距：按钮、tab、输入框必须保留可访问点击区域。

目标是减少重复结构层，而不是消灭留白。

## 当前首页候选结构（修正版）

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Reader       │                         Library   [Import]     │
│              ├──────────────────────────────────────────────┤
│ All          │ [Search library...]             [List] [More]  │
│ Recent       │                                              │
│ Favorites    │ Continue reading                             │
│              │ [文档] 书名 · 进度                         [继续]│
│ More filters │ Documents                                    │
│              │ [文档列表]                                  │
└──────────────┴──────────────────────────────────────────────┘
```

与当前实现相比，首页应优先验证：

1. 是否可以移除主区域顶部的 `Reader` 品牌和 `Library/Semantic Search` tabs，同时让侧栏或页面内入口承担导航。
2. 是否可以把 Library 页面标题、Import 和搜索合并为一个紧凑任务栏。
3. 是否可以让 Semantic Search 降为辅助入口，而不是首页顶部同级 tab。
4. 是否保留 Preferences 的直接可达性，但不单独制造第二个 header。

## 已实现对应关系

- ADR-010：继续阅读优先的首页工作台方向。
- ADR-011：Library 默认扁平集合。
- ADR-012：List 默认视图，保留 Grid / Compact。
- ADR-013：Library 顶部标题、搜索、Import 与 More 的任务分层。
- ADR-014：移除重复的首页与 Library 身份副标题。
- ADR-015：结构、内容、操作三类间距节奏。
- `SemanticSearchHome` 后续改为单列，并删除独立空历史侧栏。

## 未完成验证

这份记录不是视觉验收证明。仍需：

- 真实 Tauri 原生窗口验收。
- 真实 EPUB/Markdown 文档下的 Continue reading 与正文空间验收。
- 1024、1280、1440px 和 200% 缩放验收。
- 长标题、空 Library、筛选状态和键盘焦点验收。

不得因为参考截图相似，就宣称首页设计已完成全部验收。
