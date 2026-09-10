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

1. 定位根因：阅读调用链，确认出错层（React / Tauri / DB / parser / renderer / LLM）。
2. 先建立一个能稳定复现问题的失败测试；runner/环境错误不算 red。
3. 为该修复建立 `WI-*`，记录 red receipt，再做最小根因修复；禁止先改实现后补测试。
4. 测试转绿后再做必要重构，不改弱回归断言。
5. 进行 adversarial review 并运行 `npm run test:tdd:gate`。
6. 更新文档：若行为变化，更新 `README.md`/`FEATURES.md`/`CHANGELOG.md`。
