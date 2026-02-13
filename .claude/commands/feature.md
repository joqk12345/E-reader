---
description: reader 新功能实现流程（规划→实现→验证）
argument-hint: "[功能目标]"
---

# Feature

## 输入

```text
$ARGUMENTS
```

## 执行流程

1. 拆解功能：界面层、状态层、Tauri 命令层、数据层分别列出改动点。
2. 先定义接口：若涉及前后端通信，先确定 command 入参与返回结构。
3. 分步实现：按最小可运行单元提交变更。
4. 做最小验证：
   - `npm run build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
5. 完成收尾：更新 `README.md`/`FEATURES.md`，必要时写入 `CHANGELOG.md`。
