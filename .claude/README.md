# reader `.claude` Setup

本目录用于给 Claude Code / Codex CLI 提供项目级约束与工作流。

## 目录结构（建议最小集）

```
.claude/
├── README.md
├── settings.json
├── settings.local.json          # 本机私有（已 gitignore）
├── rules/
│   ├── 00-engineering-principles.md
│   ├── 05-tdd-refactor-governance.md
│   ├── 10-tauri-react-workflow.md
│   └── 20-codebase-conventions.md
└── commands/
    ├── fix.md
    └── feature.md
```

## 使用方式

1. `settings.json` 放团队共享开关（可提交）。
2. `settings.local.json` 放个人权限与本地偏好（不提交）。
3. `rules/` 写“自动加载”的硬约束（编码规范、验证步骤）。
4. `commands/` 写可复用的 slash command 流程模板。

## reader 项目建议约定

- 项目级 TDD 的 canonical 入口是根目录 `AGENTS.md` 和 `npm run test:tdd:gate`
- Pi 原生适配位于 `.pi/`；Claude 配置仅保留兼容性说明
- 行为变更：Plan → test matrix → Red receipt → Green → Refactor → Gate
- 完整验证：`npm run test:tdd:gate`
- 前端 lane：`npm run test:unit:coverage`
- Rust lane：`npm run test:rust`
- 变更优先级：先修根因，再做最小 diff
- 涉及跨层改动（React + Tauri）时，要求用 contract/integration test 固定接口影响
- 详细流程：`docs/development/tdd-workflow.md`

## 可选增强（后续再加）

- `.mcp.json`：注册 `codex`、`tauri` 等 MCP server
- `hooks/`：Prompt refine 或提交前检查
- `skills/`：沉淀 reader 专属技能（如 EPUB/PDF 导入链路、翻译缓存链路）
