# 05 - Reader Refactor TDD Governance

本规则适用于 Reader V2 重构的所有产品代码、迁移、解析器、适配器和 Design System 组件。

## 不可跳过的循环

每个行为变更必须按顺序执行：

1. **Plan**：分成 15–60 分钟的 Work Item（`WI-*`），写清可观察的验收条件和非目标。
2. **Design tests**：先写测试矩阵，标明 lane、行为断言、边界/失败模式；主动寻找“最简单但错误、仍能通过”的实现。
3. **Red**：先写测试并运行，确认因缺少目标行为而失败。语法错误、缺依赖、零测试不算 red。
4. **Receipt**：在 Pi 中用 `tdd_red` 记录失败测试；实现前不得修改生产代码。
5. **Green**：只写让当前测试通过的最小实现。
6. **Refactor**：测试保持绿色后才能整理结构；不得为迁就实现而弱化已有断言。
7. **Gate**：运行项目 lane、构建和 Rust check；失败时不得宣称完成或进入下一 WI。

Bug 修复必须先增加能复现该 bug 的回归测试。

## Test lanes

- `frontend-unit`：纯 TS 领域逻辑、React hooks/components、adapter contract；命令 `npm run test:unit:coverage`。
- `rust-unit`：EPUB 导入、URI/resource、数据库、locator、migration、Tauri command；命令 `npm run test:rust`。
- integration（建设中）：真实 EPUB fixture → importer → SQLite → loader/DTO；引入后绑定 commit gate。
- e2e（建设中）：Tauri 中导入 → 阅读 → TOC/CFI → 标注 → 重启恢复；引入后只绑定 push gate。

若 mock 了文件系统、SQLite、Tauri IPC、foliate-js 或 WebView 边界，必须在测试矩阵中命名一个真实 integration/e2e 配对测试。只断言 mock 被调用不算行为测试。

## Reader V2 关键不变量

以下代码必须优先使用边界、属性或状态转换测试，而非单一 happy-path example：

- `src-tauri/src/publication/**`：ZIP 安全、OPF/nav/NCX、URI 规范化、资源白名单、原子导入；
- `src/features/reader/**`：nested TOC 不扁平化、locator round-trip/fallback、引擎 adapter contract；
- database migrations：可重入、失败回滚、旧数据不删除；
- annotations/positions：主题或 viewport 改变后可 re-anchor；
- `src/design-system/**`：键盘行为、ARIA、focus、disabled/loading/error 状态。

适用时至少覆盖：round-trip、幂等性、顺序保持、路径归一化、零/空/最大值、畸形输入和明确失败模式。

## Coverage 策略

旧代码不以虚假的 100% 门槛阻塞重构。当前使用 `no-decrease` 建立基线并单向提升：

- 新模块和被修改模块必须有行为测试；
- 不允许通过排除文件、删除测试或缩小 discovery glob 提升数字；
- coverage 只证明代码被执行，不证明断言有效；关键算法后续增加 mutation gate；
- 当 publication/locator 测试基础建立后，为它们配置 absolute critical-path thresholds。

## 完成门槛

完成前必须运行：

```bash
npm run test:tdd:gate
```

并确认：

- 测试确实被发现且通过；
- `.tdd-guardian/receipts.json` 中存在本 WI 的 behavioral-red receipt，或明确说明为什么本 WI 不涉及行为代码；
- 没有改弱测试断言；
- `npm run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml` 通过；
- 用户可感知行为和架构决策同步更新文档。

仅文档、注释或 CI/TDD 基础设施变更可以不制造业务 red，但仍必须运行适用 gate，并在结果中说明豁免原因。紧急 bypass 只能在用户明确同意后使用 `TDD_GUARD_BYPASS=1`。
