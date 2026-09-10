# Reader Pi-native TDD Workflow

Reader V2 的项目级 TDD 参考了 [`xiaolai/tdd-guardian-for-claude`](https://github.com/xiaolai/tdd-guardian-for-claude) 的 lane、red receipt、coverage ratchet 和 release gate 思路，但执行层已适配为 **Pi Agent 原生扩展**，不依赖 Claude Code hooks 或 plugin marketplace。

目标不是追求测试数量，而是持续证明重构没有偏离 [`Reader V2 重构方案`](../plans/2026-08-19-reader-v2-refactor-plan.md)。

## Architecture

| 层 | 项目文件 | 作用 |
|---|---|---|
| Pi context | `AGENTS.md` | Pi 自动加载的项目硬规则 |
| Pi extension | `.pi/extensions/reader-tdd.ts` | tools、commands、状态提示、protected-action gate |
| Pi skill | `.pi/skills/reader-tdd/SKILL.md` | 按需加载的完整 TDD 流程与 Reader 不变量 |
| Pi prompts | `.pi/prompts/tdd-*.md` | `/tdd-plan`、`/tdd-design`、`/tdd-implement`、`/tdd-review` |
| Harness-neutral core | `scripts/tdd/*.mjs` | exact-tree fingerprint、coverage ratchet、gate 校验 |
| Shared config | `.tdd-guardian/config.json` | lane、freshness、protected actions |
| Local evidence | `.tdd-guardian/state.json`, `receipts.json` | gate 和 red evidence；已 gitignore |

项目首次被 Pi 打开时需要信任 project-local resources，随后执行 `/reload` 即可加载扩展、skill 和 prompts。无需安装 `tdd-guardian@xiaolai`。

## Pi tools and commands

- `tdd_red` tool：执行 focused test，只接受可识别的 behavioral assertion failure；编译、依赖、发现失败和零测试不会生成 receipt。
- `tdd_gate` tool：运行完整 gate，并将成功结果绑定到当前 `HEAD + tracked diff + untracked content`。
- `/tdd-status`：检查 receipt 是否仍精确匹配工作树。
- `/tdd-gate`：交互式运行完整 gate。
- `/skill:reader-tdd`：显式加载工作流。

任何后续文件变化都会改变 fingerprint，使 receipt 失效。Pi 扩展会在以下动作前校验 exact-tree receipt：

- `goal_complete`
- `git commit` / `git push`
- `gh pr create` / `gh pr merge`
- `npm publish` / `cargo publish`

`TDD_GUARD_BYPASS=1` 不会静默绕过；TUI 必须再次获得用户明确确认，非交互模式默认拒绝。

## Lanes

| Lane | Command | 范围 |
|---|---|---|
| `guardian-unit` | `npm run test:tdd:guardian` | fingerprint、staleness、command/red classification、coverage ratchet |
| `fixture-validation` | `npm run test:fixtures` | EPUB corpus registry、路径、许可证元数据与 SHA-256 完整性 |
| `frontend-unit` | `npm run test:unit:coverage` | TS 领域逻辑、adapter、React component/hook |
| `rust-unit` | `npm run test:rust` | parser、DB、locator、migration、commands |
| integration（下一阶段） | 待 fixture harness 建立 | EPUB → importer → SQLite → loader |
| e2e（下一阶段） | 待 Tauri harness 建立 | 导入 → 阅读 → CFI/标注 → 重启 |

完整门槛：

```bash
npm run test:tdd:gate
```

它运行 build、Cargo check、Guardian tests、前端 coverage 和 Rust tests；成功后原子写入 ignored state receipt。

## Required cycle

1. **Plan**：使用 `/tdd-plan <task>`，拆成一个个 15–60 分钟 `WI-*`，写清验收条件和非目标。
2. **Design**：使用 `/tdd-design <WI>`，覆盖行为、边界、失败、adversarial case 和 mock-to-integration counterpart。
3. **Red receipt**：先增加 focused test，再调用 `tdd_red`。必须因缺失目标行为产生 assertion failure。
4. **Green**：只实现当前 WI 所需的最小行为。
5. **Refactor**：保持测试绿色，不得删除或弱化 specification lines。
6. **Review**：使用 `/tdd-review <WI>` 主动寻找能骗过测试的错误实现和偏离 V2 方案的 scope creep。
7. **Gate**：所有编辑结束后调用 `tdd_gate`。Gate 后若再次编辑，必须重跑。

Bug 修复必须先增加稳定复现问题的回归测试。

## Coverage policy

当前前端全量 coverage 约为 `0.17%`，真实反映历史代码缺少测试。策略是：

- `coverageMode: no-decrease`，以本机首次成功 gate 为基线单向提升；
- 每个新模块和被触达模块必须增加行为测试；
- 禁止缩小 include、增加无理由 exclude、删除测试或弱化断言；
- publication/locator integration coverage 成熟后再增加 critical-path absolute thresholds；
- mutation testing 在关键 parser/locator 稳定后启用。

## Refactor-specific map

| Workstream | First test obligation |
|---|---|
| foliate-js adapter | nested TOC、CFI restore、external-link interception、flow switch |
| secure loader | ZIP Slip/zip bomb、publication-scoped paths、missing resource、script/remote fetch blocked |
| publication schema | transaction rollback、idempotent migration、source hash identity、old data retained |
| locator | CFI round-trip、quote fallback、viewport/theme changes、malformed locator |
| Design System | keyboard/ARIA/focus、disabled/loading/error、theme contrast、reduced motion |
| annotations | CFI range + quote re-anchor、unresolved annotation retained |
| e2e | import → TOC → location → restart；search/TTS/translation 返回同一 locator |

## Exceptions

纯文档、注释、CI 和 TDD 基础设施可以不制造业务 red，但必须测试新增的 executable helper，运行最终 gate，并明确记录豁免原因。不得借此夹带产品行为变更。
