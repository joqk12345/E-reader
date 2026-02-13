# 10 - Tauri + React Workflow

## 适用范围

当改动涉及 `src/` 与 `src-tauri/` 任一侧时，遵循本规则。

## 流程

1. 明确变更是否涉及 Tauri command、参数或返回结构。
2. 先改 Rust command 与错误信息，再改前端调用。
3. 若有缓存或数据库写入，确认失败回滚与错误透传。
4. 最后做最小范围验证。

## 最小验证清单

- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

## 错误处理

- Rust 对外命令统一返回 `Result<T, String>`。
- TypeScript 对 `unknown` 错误做类型收窄后再读 `message`。
