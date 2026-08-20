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

1. 按 `AGENTS.md` 把功能拆为可独立 red-green-refactor 的 `WI-*`。
2. 先定义行为、边界、失败模式与 lane，再定义跨层接口和测试矩阵。
3. 对每个 WI 先获得有效 behavioral-red receipt，再做最小实现；不得并行推进 WI。
4. 若涉及前后端通信，先用 contract/integration test 固定 command 入参与返回结构，再同步 Rust 和 React。
5. 进行 adversarial review 并运行 `npm run test:tdd:gate`。
6. 完成收尾：更新 `README.md`/`FEATURES.md`，必要时写入 `CHANGELOG.md`；保存测试矩阵和 gate 证据。
