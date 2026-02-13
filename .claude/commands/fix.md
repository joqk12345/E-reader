---
description: reader 项目问题修复流程（根因导向）
argument-hint: "[错误描述或复现步骤]"
---

# Fix

## 输入

```text
$ARGUMENTS
```

## 执行流程

1. 定位根因：阅读调用链，确认出错层（React / Tauri / DB / LLM）。
2. 最小修复：只改必需文件，避免顺手重构。
3. 防回归：补充或更新最接近的验证（若已有测试框架则补测试）。
4. 执行验证：
   - `npm run build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
5. 更新文档：若行为变化，更新 `README.md`/`FEATURES.md`/`CHANGELOG.md`。
