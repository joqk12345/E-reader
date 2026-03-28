# lama-swap 本地部署与 Reader 接入手册

本文基于当前这套本地 `lama-swap` 配置整理，目标是稳定提供：

- 翻译模型：`hy-mt1.5-1.8b`
- Embedding 模型：`snowflake-arctic-embed-l-v2.0`
- 备用 Embedding 模型：`nomic-embed-text-v1.5`

适用场景：

- 本机按需加载多个 GGUF 模型
- 通过 OpenAI-compatible API 暴露 `/v1/models` 和 `/v1/embeddings`
- 接入 Reader 做整库语义检索和文档重建

## 1. 当前建议架构

### 1.1 模型分工

- `hy-mt1.5-1.8b`
  - 用途：翻译
  - 不要用于 embedding
- `snowflake-arctic-embed-l-v2.0`
  - 用途：主 embedding 模型
  - 当前已验证可用
  - 输出维度：`1024`
- `nomic-embed-text-v1.5`
  - 用途：备用 embedding 模型
  - 当前在本机 `/v1/embeddings` 路径下曾出现过 `502 upstream command exited prematurely`
  - 在未确认稳定前，不建议作为 Reader 的 active embedding

### 1.2 当前建议端口

- `lama-swap`: `http://127.0.0.1:8080/v1`
- `Reader` embedding provider base URL: `http://127.0.0.1:8080/v1`

### 1.3 模型选择逻辑

这套配置的核心原则不是“哪个模型都能互换”，而是按任务类型固定分工。

#### 任务到模型的映射

- 只要任务是“翻译”：
  - 选 `hy-mt1.5-1.8b`
- 只要任务是“生成向量 / 建索引 / 语义检索”：
  - 优先选 `snowflake-arctic-embed-l-v2.0`
- 只有在你明确要测试替代 embedding 效果时：
  - 才切到 `nomic-embed-text-v1.5`

#### 为什么默认选 `snowflake`

- 这套本地环境里它已经实际验证通过
- `/v1/embeddings` 能稳定返回结果
- 维度固定为 `1024`
- Reader 现有库已经按它完成过全量重建

#### 为什么 `nomic` 不是默认

- 它当前不是“完全不可用”，而是“稳定性还不够”
- 实测在本地 `lama-swap` 路径下曾出现过 `502 upstream command exited prematurely`
- 一旦把它设成 active embedding，整库检索和自动重建都会跟着受影响

#### 实际决策顺序

1. 先判断是不是 embedding 任务
2. 如果不是 embedding，而是翻译任务，固定走 `hy-mt1.5-1.8b`
3. 如果是 embedding 任务，默认走 `snowflake-arctic-embed-l-v2.0`
4. 只有在你明确要做 A/B 测试时，才把 embedding 切到 `nomic-embed-text-v1.5`
5. 如果 `nomic` 出现 `502` 或冷启动异常，立即切回 `snowflake`

#### 对 Reader 的具体含义

- `Chat / Summary / Translate` 不应复用 embedding 模型
- `embedding` Agent slot 只绑定 embedding 模型
- 当前最稳的配置是：
  - `Translate` 使用 `hy-mt1.5-1.8b`
  - `Embedding` 使用 `snowflake-arctic-embed-l-v2.0`

#### 什么时候可以考虑切到 `nomic`

只有同时满足下面几条，才建议切换：

1. 手工调用 `/v1/embeddings` 连续多次都稳定
2. 返回维度已确认，并已同步到 Reader 配置
3. 你愿意重新做一轮全库 re-embed
4. 你接受检索效果和稳定性需要重新验证

## 2. 参考模型配置

下面是按你当前实际用法整理后的推荐配置片段。

```yaml
"hy-mt1.5-1.8b":
  cmd: |
    ${latest-llama}
    --model ${models_dir}/tencent/HY-MT1.5-1.8B-GGUF/HY-MT1.5-1.8B-Q8_0.gguf
    --ctx-size ${default_ctx}
    --temp 0.7
    --top-p 0.6
    --top-k 20
  name: "Hunyuan Translation Model v1.5"
  checkEndpoint: /health
  ttl: 3600
  aliases:
    - "hy-mt"

"nomic-embed-text-v1.5":
  cmd: |
    ${latest-llama}
    --model ${models_dir}/nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q8_0.gguf
    --ctx-size 8192
    --batch-size 8192
    --ubatch-size 4096
    --rope-scaling yarn
    --rope-freq-scale 0.75
    -ngl 99
    --embeddings
  aliases:
    - "nomic"

"snowflake-arctic-embed-l-v2.0":
  cmd: |
    ${latest-llama}
    --model ${models_dir}/Casual-Autopsy/snowflake-arctic-embed-l-v2.0-gguf/snowflake-arctic-embed-l-v2.0-q8_0.gguf
    --ctx-size 8192
    --batch-size 8192
    --ubatch-size 4096
    --rope-scaling yarn
    --rope-freq-scale 0.75
    -ngl 99
    --embeddings
  aliases:
    - "snowflake"
```

## 3. 本地部署建议

### 3.1 目录规划

建议统一模型目录：

```bash
~/Models/
```

建议布局：

```text
~/Models/
├── tencent/
│   └── HY-MT1.5-1.8B-GGUF/
│       └── HY-MT1.5-1.8B-Q8_0.gguf
├── nomic-ai/
│   └── nomic-embed-text-v1.5-GGUF/
│       └── nomic-embed-text-v1.5.Q8_0.gguf
└── Casual-Autopsy/
    └── snowflake-arctic-embed-l-v2.0-gguf/
        └── snowflake-arctic-embed-l-v2.0-q8_0.gguf
```

### 3.2 启动原则

- 所有 embedding 模型都必须带 `--embeddings`
- embedding 模型建议显式开启 GPU 层：
  - `-ngl 99`
- 大上下文 embedding 建议：
  - `--ctx-size 8192`
  - `--batch-size 8192`
  - `--ubatch-size 4096`
- 当前这套 `snowflake` / `nomic` 都使用了：
  - `--rope-scaling yarn`
  - `--rope-freq-scale 0.75`

### 3.3 on-demand 加载建议

- 保留 `ttl: 3600`
  - 适合桌面阅读器场景
  - 1 小时内重复搜索不需要反复冷启动
- 使用别名降低调用复杂度
  - `hy-mt`
  - `nomic`
  - `snowflake`

## 4. 启动后验证

### 4.1 检查模型列表

```bash
curl --noproxy '*' http://127.0.0.1:8080/v1/models
```

期望至少看到：

- `hy-mt1.5-1.8b`
- `nomic-embed-text-v1.5`
- `snowflake-arctic-embed-l-v2.0`

### 4.2 验证主 embedding 模型

```bash
curl --noproxy '*' http://127.0.0.1:8080/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "snowflake-arctic-embed-l-v2.0",
    "input": "杨植麟"
  }'
```

验证点：

- HTTP 返回 `200`
- `data[0].embedding` 存在
- 向量长度为 `1024`

### 4.3 验证备用 embedding 模型

```bash
curl --noproxy '*' http://127.0.0.1:8080/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "nomic-embed-text-v1.5",
    "input": "test"
  }'
```

说明：

- 如果这里返回 `502`，说明该模型当前在你的本地运行条件下并不稳定
- 这种情况下不要把 Reader 的 active embedding 切到 `nomic`

## 5. Reader 接入建议

### 5.1 推荐配置

当前验证通过的 Reader embedding 配置如下：

```json
{
  "embedding_provider": "openai_compatible",
  "embedding_model": "snowflake-arctic-embed-l-v2.0",
  "embedding_dimension": 1024,
  "embedding_auto_reindex": true,
  "ai_profiles": {
    "providers": [
      {
        "display_name": "lama-swap",
        "provider_type": "open_ai_compatible",
        "base_url": "http://127.0.0.1:8080/v1",
        "api_key": null
      }
    ]
  }
}
```

### 5.2 在 Reader 里怎么配

1. 打开 `Settings -> AI & Embedding`
2. 在 `Providers` 中新增或编辑 `OpenAI Compatible`
3. 设置：
   - `Base URL`: `http://127.0.0.1:8080/v1`
   - `API Key`: 留空
4. 在 `Models` 中新增 `embedding` 模型
5. 设置：
   - `Model Name`: `snowflake-arctic-embed-l-v2.0`
   - `Embedding Dimension`: `1024`
6. 在 `Agents` 中把 `embedding` slot 指到该模型
7. 打开 `Auto reindex`

## 6. 全库重建 embedding

仓库里已经准备了全量重建脚本：

```bash
node scripts/rebuild-lamaswap-embeddings.mjs
```

默认参数：

- endpoint: `http://127.0.0.1:8080/v1`
- model: `snowflake-arctic-embed-l-v2.0`
- dimension: `1024`
- batch size: `32`

可选环境变量：

```bash
READER_EMBEDDING_ENDPOINT=http://127.0.0.1:8080/v1
READER_EMBEDDING_MODEL=snowflake-arctic-embed-l-v2.0
READER_EMBEDDING_DIMENSION=1024
READER_EMBEDDING_BATCH_SIZE=32
READER_EMBEDDING_TIMEOUT_MS=120000
READER_EMBEDDING_PAUSE_MS=0
READER_EMBEDDING_START_OFFSET=0
```

示例：

```bash
READER_EMBEDDING_MODEL=snowflake-arctic-embed-l-v2.0 \
READER_EMBEDDING_DIMENSION=1024 \
node scripts/rebuild-lamaswap-embeddings.mjs
```

## 7. 运行时行为说明

### 7.1 当前 Reader 中已经支持

- remote embedding 文档自动重建
- `Rebuild Index` 走 remote embedding
- 首页独立 `Semantic Search` tab
- 最近搜索记录持久化
- embedding 失败时自动回退到关键词检索

### 7.2 当前推荐策略

- `snowflake-arctic-embed-l-v2.0` 作为主 embedding
- `nomic-embed-text-v1.5` 先只保留在 `lama-swap` 中，不作为 Reader 默认模型
- `hy-mt1.5-1.8b` 专用于翻译，不参与 embedding

## 8. 常见问题

### 8.1 为什么会出现 `Keyword Fallback`

原因通常是：

- embedding 模型冷启动失败
- `lama-swap` 上游进程异常退出
- `/v1/embeddings` 短时间返回 `502`

建议排查：

1. 先手工打一次 `/v1/embeddings`
2. 再确认 `snowflake-arctic-embed-l-v2.0` 是否已正常加载
3. 如果是冷启动不稳定，可适当延长 `ttl`

### 8.2 为什么 `hy-mt1.5-1.8b` 不能做 embedding

因为它是翻译生成模型，不是 embedding 模型，没有 `--embeddings` 运行模式，也不应作为向量检索引擎。

### 8.3 为什么 `nomic` 不推荐直接切成默认

因为这套本地环境里它曾实际返回：

- `502 upstream command exited prematurely`

在没有把稳定性问题解决前，不建议用它承担 Reader 的全库检索。

### 8.4 中文检索报过的 UTF-8 截断错误是什么

之前 Reader 在关键词 fallback 里按字节裁剪 snippet，中文可能会切进一个汉字中间，导致 Rust panic。这个问题已经修复，现在会按字符安全截断。

## 9. 最终建议

如果你要的是一套当前可稳定使用的本地方案，建议固定为：

- `lama-swap` 作为统一 OpenAI-compatible 网关
- `snowflake-arctic-embed-l-v2.0` 作为 Reader 主 embedding
- `hy-mt1.5-1.8b` 作为翻译模型
- `nomic-embed-text-v1.5` 保留为实验性备用模型

这样可以同时满足：

- on-demand 模型加载
- 本地语义检索
- 全库 embedding 重建
- Reader 内部 remote embedding 工作流
