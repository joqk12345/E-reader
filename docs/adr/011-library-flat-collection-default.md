# ADR-011：Library 默认采用扁平文档集合

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Library 文档列表、Category 分组、DocumentCard metadata 和 Display Options
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007、ADR-008、ADR-010

## 背景

Library 已经通过侧栏提供 Category 筛选，同时文档区域还会按 Category 分组，并在每张 DocumentCard 上重复显示 Category。这样会让分类标题、数量、标签和文档标题同时竞争注意力。

用户进入 Library 的主要任务是找到并打开文档，而不是浏览分类目录。默认分类分组会增加垂直断点和扫描成本，削弱文档标题的视觉优先级。

## 决策

1. Library 默认采用扁平的文档集合，不按 Category 分组。
2. `Group by category` 作为 Display Options 中的可选二级组织方式保留。
3. Category 筛选继续保留，但与 Category 分组明确区分：
   - 筛选：只显示选定类别。
   - 分组：显示全部文档并按类别组织。
4. 默认网格、列表和紧凑视图都以文档标题为主要视觉焦点。
5. DocumentCard 上的 Category 仅作为低对比度 metadata，不得超过标题权重。
6. Category 分组仅在用户主动开启后显示分类标题、数量和折叠控件。
7. 不改变 Category 推断、筛选语义、文档打开、收藏、删除或历史 PDF 识别行为。

## CRAP 转译

- **Contrast**：文档标题和 Continue reading 优先于分类信息。
- **Repetition**：分类不同时以侧栏、分组标题和强卡片标签重复强调。
- **Alignment**：扁平集合使用稳定统一的网格和列表边界，减少分组断点。
- **Proximity**：文档标题、作者、日期和打开动作保持紧密；分类作为辅助 metadata 或主动组织方式。

## 后果

### 正面

- 默认页面更简洁，用户更容易扫描和打开文档。
- 减少分类标题、数量和折叠控件造成的视觉噪音。
- 小型和中型 Library 不会被不必要的分组结构撑大。
- 需要分类浏览的用户仍可主动启用分组。

### 代价

- 分类导向的用户需要额外打开一次 Display Options。
- 大型 Library 默认扁平列表的扫描效率可能下降，因此需要保留搜索和筛选。
- UI smoke 需要覆盖默认扁平状态和主动开启分组状态。

## 非目标

- 不删除 Category 筛选或自动分类能力。
- 不删除 Display Options 中的 Group by category。
- 不修改 EPUB/Markdown 阅读、搜索、Locator、publication、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- 默认进入 Library 时文档不按 Category 分组。
- Display Options 仍可开启 Group by category。
- Category 筛选仍能只显示目标类别。
- DocumentCard 的标题视觉权重高于 Category metadata。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
