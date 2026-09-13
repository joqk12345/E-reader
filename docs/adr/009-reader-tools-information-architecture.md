# ADR-009：Reader 右侧工具信息架构与任务分组

- 状态：Proposed design direction
- 日期：2026-09-12
- 范围：Reader 右侧工具栏、TOC、AI 面板、选区动作
- 依据：《The Non-Designer’s Design Book》的 CRAP 原则，以及 ADR-005、ADR-007、ADR-008

## 背景

Reader 右侧工具包含 Search、Dictionary、Translate、Summary、Understand、Deep Analysis、Chat、Notes、Annotations、Tags、Audiobook 等能力。若所有工具以同等权重排列，用户需要在长列表中寻找动作，工具栏也会与正文争夺注意力。

## 决策

右侧工具栏采用“任务分组 + 高频优先 + 渐进披露”的结构：

1. 高频阅读辅助工具优先展示：Search、Dictionary、Translate。
2. 内容理解工具归为一组：Summary、Explain/Understand、Ask/Chat、Deep Analysis。
3. 记录与管理工具归为一组：Notes、Annotations、Tags。
4. 音频工具单独归组：Audiobook / TTS。
5. 默认只展示高频工具，其余工具通过 More tools 展开。
6. 当前工具使用 action-subtle 和 accent indicator 突出；普通工具保持低对比度。
7. 工具图标、文字和面板内容使用统一对齐边界与间距。
8. 面板内容采用固定层级：Context → Result → Actions。
9. 选区 Quick Actions 与右侧工具共享按钮、focus-visible、浮层和状态规则。
10. 窄窗口下右侧工具优先收起或覆盖显示，不挤压正文阅读区域。

## CRAP 转译

- **Contrast**：突出当前工具和高频任务，不让所有工具同时抢占注意力。
- **Repetition**：统一 tab、面板标题、AI 卡片、操作按钮和状态样式。
- **Alignment**：工具入口、内容卡片和动作区共用同一内容边界。
- **Proximity**：按照“阅读辅助、理解内容、记录管理、音频”分组，而不是按实现组件排列。

## AI 面板结构

AI 面板统一遵循：

```text
Context
Result
Actions
```

- Context 显示当前选中文本、章节或请求来源。
- Result 显示 Summary、Explanation 或 Answer。
- Actions 提供 Copy、Ask follow-up、Save as note 等后续动作。

错误、加载和空状态应靠近其所属内容，并提供明确的恢复动作。

## 后果

### 正面

- 用户能按任务而不是按功能名称寻找工具。
- 右侧工具栏减少视觉噪音，正文保持第一注意力。
- AI 输出、选区动作和普通工具共享一致的交互语言。
- 窄窗口下正文不会被多个侧栏持续压缩。

### 代价

- 低频工具需要额外一次展开操作。
- 需要维护工具分组、展开状态和键盘导航顺序。
- UI smoke 和可访问性验收需要覆盖 More tools、当前 tab、focus 恢复和窄窗口行为。

## 非目标

- 不删除 Search、Translation、AI、Notes、Annotations、TTS 或其他既有能力。
- 不改变 AI 调用合同、Locator、publication、数据库、Tauri IPC 或阅读位置。
- 不修改正文渲染和 EPUB 安全边界。
- 不重新加入 PDF 阅读支持。

## 验收

- 高频工具可直接访问，低频工具可通过 More tools 访问。
- 工具按任务分组，当前工具具有清晰但克制的状态对比。
- AI 面板维持 Context → Result → Actions 顺序。
- 选区动作具备可访问名称、可见 focus 和边界内定位。
- 右侧工具在窄窗口下不挤压正文。
- `npm run test:ui`、`npm run check:styles`、相关单元测试和 `npm run test:tdd:gate` 通过。
