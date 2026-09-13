# ADR-012：Library 显示密度与多视图模式

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Library DocumentCard、Grid/List/Compact 视图和 Display Options
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-007、ADR-010、ADR-011

## 背景

当前 Library 的卡片视图在没有封面内容时占用较大空间，卡片内部信息不足以支撑其面积。用户的主要任务是扫描、找到并继续阅读文档，而不是浏览视觉卡片，因此需要区分“看、找、管”三种使用场景。

## 决策

1. Library 保留三种显示模式：Grid、List、Compact。
2. 默认使用 List 模式，因为它最适合扫描文档标题、作者、日期和类型，并能保护正文区域。
3. Grid 模式用于视觉浏览；在没有封面时保持较低密度，避免无意义的大面积空白。
4. Compact 模式用于高密度管理，只显示标题、类型和核心操作。
5. 三种模式共享相同的信息优先级、操作语义和 focus-visible 状态；只改变布局密度。
6. 标题是主要视觉焦点；作者、日期、类型和 tags 是辅助 metadata；收藏和删除固定在右侧操作区。
7. 视图切换作为高频操作直接可见；排序、分组、类型筛选和高级选项继续放在 Display Options 中。
8. Grid、List、Compact 切换按钮必须使用清晰的可访问名称和 `aria-pressed`。
9. 视图切换不改变文档排序、筛选、打开、收藏、删除或历史 PDF 识别行为。

## 推荐密度

```text
Grid：视觉浏览，适合较少文档
List：默认扫描，适合大多数 Library
Compact：高密度管理，适合大量文档
```

建议密度目标：

- Grid：缩小无封面状态下的空白和 padding。
- List：单项约 56–72px 高。
- Compact：单项约 36–44px 高。

## CRAP 转译

- **Contrast**：只突出当前视图和文档标题，避免三个视图按钮同时抢占注意力。
- **Repetition**：不同模式复用标题、metadata、操作区、类型标识和状态规则。
- **Alignment**：标题左对齐，metadata 与操作区域使用稳定边界，操作按钮右对齐。
- **Proximity**：标题、作者、日期、类型和操作按阅读任务紧密排列；低频设置收入 Display Options。

## 后果

### 正面

- 默认 List 能提高文档扫描效率。
- Grid 不再因为缺少封面而显得空旷。
- Compact 为大量文档提供高密度管理方式。
- 视图切换不会破坏既有筛选和文档操作语义。

### 代价

- 需要维护三种模式的响应式布局和视觉一致性。
- 需要为每种模式覆盖标题截断、长作者、tags、键盘 focus 和窄窗口行为。
- 默认视图从 Grid 改为 List，已有用户可能需要重新适应。

## 非目标

- 不删除 Grid、List 或 Compact 任一模式。
- 不引入封面资源处理或修改 publication 数据结构。
- 不改变 EPUB/Markdown 阅读、搜索、Locator、数据库、Tauri IPC 或 AI 合同。
- 不重新加入 PDF 阅读支持。

## 验收

- Library 默认使用 List 视图。
- Grid、List、Compact 均可通过明确的可访问控件切换。
- DocumentCard 三种模式共享一致的信息层级和操作语义。
- Grid 在无封面时不会产生过度空白。
- 窄窗口下 List 和 Compact 不发生横向溢出。
- `npm run test:ui`、相关单元测试、`npm run check:styles` 和 `npm run test:tdd:gate` 通过。
