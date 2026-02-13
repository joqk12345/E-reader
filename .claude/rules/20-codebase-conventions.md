# 20 - Reader Codebase Conventions

## 前端

- Zustand 在组件内避免整体解构，优先按需读取。
- 新增 UI 状态时，先确认是否可复用现有 store。
- 组件逻辑变更时，避免同时改动视觉样式与业务逻辑。

## 后端

- Tauri command 放在 `src-tauri/src/commands/` 下对应模块。
- 数据库相关改动优先复用 `src-tauri/src/database/` 现有层。
- 新增 command 后记得在 `src-tauri/src/lib.rs` 注册。

## 文档

- 用户可感知功能变化时，更新 `README.md` 或 `FEATURES.md`。
- 版本发布相关改动同步更新 `CHANGELOG.md` 与 `RELEASE.md`。
