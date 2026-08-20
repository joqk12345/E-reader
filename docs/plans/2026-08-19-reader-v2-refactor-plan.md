# Reader V2 重构方案：项目目标、EPUB 内核与 Design System

- 状态：**Active（Phase 0 实施中）**
- 日期：2026-08-19
- 范围：产品目标、阅读架构、Design System、迁移路线与验收门槛
- 关联：[`DESIGN.md`](../../DESIGN.md) 是 V1 历史设计；本方案作为 V2 重构依据

## 0. 执行摘要

这次重构不应从“修几个 EPUB 正则”或“换一套页面颜色”开始，而应同时建立两条独立但协作的基础设施：

1. **Publication Engine（出版物内核）**：忠实解析和呈现 EPUB 原始结构、资源、样式与定位；
2. **Application Design System（应用 Design System）**：统一书库、工具栏、设置、弹窗等应用 UI；书籍正文样式与应用 UI 必须隔离。

当前 EPUB 兼容性差的根因是数据链路本身有损：`src-tauri/src/parsers/epub.rs` 用正则删除 XHTML 标签，仅保存纯文本；`src-tauri/src/parsers/mod.rs` 的 `ParsedChapter` 只能表达 `(title, order, href, Vec<String>)`；数据库仅保存 section/paragraph；前端再把文本按句子重组。因此图片、内嵌字体、CSS、列表、表格、脚注、语义层级、SVG/MathML、RTL，以及稳定位置均已在导入时丢失，无法靠渲染层补回。

V2 采用**双轨内容模型**：

- 原始出版物轨：保留 manifest、spine、TOC、XHTML、CSS、字体、图片和布局元数据，用于忠实阅读；
- 语义内容轨：从 DOM 生成可搜索、翻译、摘要、TTS 的 block，保存其到原始 DOM/EPUB CFI 的定位映射。

建议先完成 2 个短期 spike（以 [foliate-js](https://github.com/johnfactotum/foliate-js) 为首选候选的引擎验证、数据迁移），再按“兼容基线 → Design System 基线 → 阅读闭环 → AI 能力迁移 → 长尾格式”分阶段交付。不要在新内核稳定前重写所有 AI 面板。

---

## 0.1 实施进度（2026-08-20）

已完成：

- 建立 Pi-native TDD、red receipt、coverage ratchet 和 exact-working-tree gate；
- 固定 foliate-js commit `78914aef...`，通过 `VITE_EPUB_ENGINE=foliate` 接入可回退 spike；
- spike 已具备嵌套 TOC、href 导航、分页/滚动、relocate/CFI localStorage 和外链事件；
- 建立首批两个 CC0 最小 fixture：EPUB 3 nested nav/resource、EPUB 2 short NCX TOC；fixture registry 会校验路径、许可证元数据和 SHA-256；
- 建立 Rust EPUB ZIP 安全预检，覆盖路径穿越、绝对/反斜杠路径、规范化后重复路径、符号链接、条目/单文件/总大小和压缩比限制；
- 建立 publication-scoped resource resolver，按 base href 解析相对 URI 和 percent encoding，并拒绝外部 scheme、越界 traversal、编码分隔符、未知资源及非 allowlisted base；
- 建立只读 ZIP publication resource store，将安全预检和 allowlist 串联为按需 `load_text` / `load_blob` / `get_size`，并对实际解压字节执行声明大小边界校验；
- 建立版本化 `publication_*_v2` command 和 opaque session registry：只接受数据库 `documentId` 打开 EPUB，不允许前端提交文件路径；各 publication allowlist 和文件句柄按 session 隔离；
- 建立前端 `TauriPublicationLoader` contract adapter；open DTO 返回 scoped resource-size index，以满足 foliate-js 同步 `getSize(href)`，文本/Blob 仍按需通过 session command 读取；
- flagged foliate spike 已通过 `TauriPublicationLoader` 创建 `EPUB` book，不再读取前端 `file_path` 或调用 `convertFileSrc`；初始化失败、切书和卸载均关闭 opaque session；
- 建立最小 CSP 与 asset scope 配置基线：静态文件访问限于 app-private 目录，启动时仅恢复数据库内 PDF 精确路径和显式本地模型目录；publication manifest script 在 foliate loader 边界再次拒绝；
- 新增 `active-content-epub3.epub` 安全 fixture，登记 manifest/inline script、event handler、remote fetch/image/CSS/frame/form 和 `javascript:` probes；外链 shell 边界仅允许 HTTP(S)/mailto；flagged reader 会在真实 WebView 延迟采集执行标记和 remote Resource Timing，并保存可导出的 probe report；
- `TauriPublicationLoader` 新增 opt-in 性能观测，记录 text/Blob command 数、解码字节、missing/failure、累计 invoke 时延和最大 Blob，用于真实 WebView 性能基线；
- 完成 [ADR-001](../adr/001-epub-rendering-engine.md)：foliate-js 条件性接受为 Phase 0/后续 EpubAdapter 候选，明确固定版本、adapter 边界、升级流程、回退方案和生产退出条件；
- 完成 [ADR-002](../adr/002-publication-resource-storage.md)：V2 canonical source 使用 app data 内不可变、按 SHA-256 寻址的已验证 EPUB archive；资源按需读取，原始用户路径仅作为导入/迁移输入。

尚未达到 Phase 0 退出门槛：兼容报告和性能基线未生成，ADR-003～004 未完成，Tauri WebView 恶意 fixture/CSP 跨平台实证、Blob IPC 性能和 DB backup/migration 框架仍缺失。当前 foliate-js 路径必须保持实验性且默认关闭。

---

## 1. 当前状态与问题证据

### 1.1 已有优势

- Tauri 2 + React + Rust + SQLite 的桌面架构适合 local-first 阅读器。
- 已有书库、TOC、搜索、翻译、摘要、TTS、标注、MCP 等完整功能雏形。
- Rust 数据库层和 Tauri command 已分模块，具备渐进迁移条件。
- 已有 5 个阅读主题和字号、行高、内容宽度等阅读设置。

### 1.2 结构性问题

| 现状证据                                                                            | 造成的问题                                     | 重构结论                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `src-tauri/src/parsers/epub.rs::extract_text_from_html` 通过字符串替换和 `<[^>]+>` 删除标签 | 列表、标题、表格、链接、ruby、脚注、图片、SVG、MathML 全部退化为文本 | 不再以纯文本作为 EPUB 的 canonical representation                       |
| TOC 少于 15 项就改用 spine                                                            | 合法的短篇 EPUB 会失去作者目录；spine id 变成伪章节名        | TOC 与 spine 分别解析，不使用数量启发式替换                                    |
| resource 匹配使用 `ends_with` / `contains`                                          | 同名资源、相对路径、percent encoding 容易误匹配          | 按 OPF base URI 做规范化 URI 解析                                     |
| `location = "{href}#p{index}"`                                                  | 不是 EPUB CFI，也无法在 DOM 改变后稳定恢复              | 使用可序列化 Locator：CFI + href + CSS selector + text quote fallback |
| 数据库只有 documents/sections/paragraphs                                             | 无 manifest、spine、资源、版式、导航层级、解析诊断          | 新增 publication/resource/spine/nav/content_block 模型            |
| `ReaderContent.tsx` 约 3,779 行，混合 EPUB/PDF/Markdown、翻译、TTS、标注、选择菜单和渲染            | 任一格式变更都影响整页，难测试、难替换                       | 以格式 adapter + 阅读 shell + capability hooks 拆分                   |
| `App.css` 仍含 Vite 模板全局样式，Tailwind config 无 tokens，源码存在大量硬编码颜色                   | 组件视觉与交互状态不一致，主题无法覆盖应用壳                    | 建立语义 token 和基础组件，不再依赖散落 utility 组合定义规范                         |
| 项目中没有 EPUB fixture，也没有 parser/reader 测试文件                                       | 兼容性只能靠人工偶然发现                              | 建立合法、边界、恶意 EPUB corpus 和分层自动化测试                                |

### 1.3 不应继续的方向

- 不再给 `extract_text_from_html` 添加更多 replace/regex。
- 不将 EPUB 转成 Markdown 后再阅读；这仍是有损转换。
- 不让书籍 CSS 直接注入应用 DOM。
- 不在一个“大爆炸”分支同时重写 EPUB、PDF、AI、书库和设置。
- 不以“能打开一本测试书”作为兼容验收。

---

## 2. V2 项目定义

### 2.1 产品愿景

> Reader 是一款 local-first 桌面深度阅读器：首先准确、稳定地呈现用户拥有的出版物，其次让搜索、翻译、摘要、标注和 TTS 建立在可追溯的原文位置上。

### 2.2 价值排序

发生冲突时按以下优先级决策：

1. **内容完整性**：不丢正文、结构和关键资源；
2. **阅读稳定性**：可导航、可恢复、无崩溃和空白章节；
3. **用户控制与隐私**：本地优先、网络能力明确可见；
4. **可访问性**：键盘、屏幕阅读器、对比度、缩放可用；
5. **视觉忠实度**：尊重出版物样式，同时允许用户覆盖可读性设置；
6. **AI 增强**：不得破坏前五项，输出能回到原文位置；
7. **功能数量**。

### 2.3 目标用户与核心任务

| 用户      | Job to be done       | 最低成功标准                    |
| ------- | -------------------- | ------------------------- |
| 长篇阅读者   | 导入并连续阅读小说/非虚构书籍      | 章节完整、进度稳定、字体与主题舒适         |
| 学术/技术读者 | 阅读含表格、代码、公式、脚注的 EPUB | 结构不丢失，链接/注释可返回原文          |
| 双语学习者   | 对照翻译并听读              | 原文与译文 block 对齐，TTS 高亮位置正确 |
| 隐私敏感用户  | 离线管理与分析本地书籍          | 核心阅读完全离线，远程 AI 必须显式配置     |
| 辅助技术用户  | 用键盘、缩放、屏幕阅读器完成阅读     | 关键流程符合 WCAG 2.2 AA 的桌面适用项 |

### 2.4 V2 目标（可度量）

#### G1 — EPUB 兼容与完整性

- EPUB 2/3 reflowable 基准 corpus：**导入成功率 ≥ 98%**；
- 所有 spine 文档可打开，空白/异常章节有诊断而非静默丢失；
- 标题、段落、列表、表格、图片、链接、脚注、内嵌字体、SVG 基础用例通过率 **100%**；
- 10MB EPUB 冷导入 P95 < 5s（不含 embedding），章节切换 P95 < 200ms；
- 阅读进度重启后恢复误差：同一 block 内或 CFI 可解析位置。

#### G2 — 阅读体验

- 打开书到可读首屏 P95 < 1s（已导入书籍）；
- 主题/字号切换不重新导入，不丢位置；
- 键盘可完成：打开书、TOC 导航、翻页、搜索、关闭弹层；
- 200% UI 缩放下无关键操作被遮挡。

#### G3 — 架构可维护性

- EPUB、PDF、Markdown 各自通过统一 `PublicationAdapter` 接入，不在单组件内按格式堆叠主流程；
- 单个核心 React 文件目标 < 500 行（少数渲染映射文件可例外并说明）；
- parser、locator、migration 有 Rust 单元/集成测试；reader shell 有组件/端到端测试；
- Tauri command 使用版本化 DTO，错误包含稳定 code 和可读 message。

#### G4 — Design System

- 新增/重构 UI 仅使用语义 token；
- Button、IconButton、Input、Select、Dialog、Popover、Tabs、Tooltip、Toast、EmptyState、Spinner、Panel 等基础组件覆盖主要界面；
- light/dark/high-contrast 与 reader themes 职责清晰；
- 所有交互组件具备 hover/focus/active/disabled/error/loading 状态。

### 2.5 非目标与边界

#### V2 首个稳定版非目标

- DRM EPUB；
- 云同步、账户、协作；
- 完整支持 EPUB Media Overlays、脚本化 EPUB；
- 移动端；
- 一次性重写 PDF/Markdown parser；
- 插件市场。

#### 分级支持策略

- **P0 / 必须**：EPUB 2/3 reflowable、nav/NCX、图片、CSS、字体、表格、脚注、基础 SVG/MathML fallback、LTR/RTL 基础、稳定 locator。
- **P1 / 后续稳定版**：fixed-layout、vertical writing、复杂 ruby、media overlays。
- **P2 / 明确提示**：scripted content、交互教材、非标准加密；不可支持时显示 import report，不静默降级。
- **不支持**：DRM，显示原因与帮助文档。

---

## 3. 产品原则与体验架构

### 3.1 产品原则

1. **书是主角，工具按需出现**：阅读模式默认降低应用 chrome 的视觉权重。
2. **保真与可读性可切换**：提供 `Publisher` 与 `Reader` 两类样式策略，而不是永久删除出版社 CSS。
3. **位置是一级数据**：进度、搜索、标注、TTS、翻译共享 locator，不各造一套 paragraph index。
4. **失败可解释**：导入结果包含警告、缺失资源、降级项和修复建议。
5. **AI 是旁路能力**：没有模型或网络时，导入、阅读、TOC、搜索（关键词）、标注仍可用。
6. **格式隔离**：EPUB、PDF、Markdown 的格式特性在 adapter 内解决，Reader Shell 不猜格式细节。

### 3.2 信息架构

```text
Home
├─ Library
│  ├─ Collections / Tags / Filters
│  └─ Import Center (progress + import report)
├─ Search
└─ Settings
   ├─ Reading
   ├─ Accessibility
   ├─ AI & Embedding
   ├─ Audio
   ├─ Shortcuts
   └─ Integrations

Reader
├─ Top bar: 返回 / 书名 / 搜索 / 阅读设置
├─ Navigation panel: 分层 TOC / 书签 / 搜索结果
├─ Reading viewport: Publication Renderer
├─ Context actions: 标注 / 翻译 / 解释 / TTS
└─ Tool workspace: 按需打开，默认不挤压正文
```

### 3.3 核心流程验收

1. **导入**：选文件 → 校验容器 → 解析 package → 保存原始资源/索引 → 显示封面 → 可立即阅读；embedding 在后台且不阻塞。
2. **继续阅读**：打开书 → 恢复 locator → 若 locator 失效，按 text quote → href → spine index 降级。
3. **TOC 导航**：保留层级 → 点击目标 → 精确滚动 → 焦点进入正文标题。
4. **搜索**：结果展示章节和 snippet → 点击后用 locator 定位并高亮，不只切换到章节首。
5. **标注**：选区保存 CFI range + text quote → 重启恢复 → 样式变动后仍能 re-anchor。
6. **翻译/TTS**：操作 semantic block → UI 反馈加载/失败/重试 → 输出与 block locator 绑定。

---

## 4. EPUB 内核方案

### 4.1 关键架构决策

采用 `PublicationAdapter` 边界，React 不直接依赖某个 EPUB 第三方库的对象模型：

```ts
interface PublicationAdapter {
  open(publicationId: string): Promise<PublicationSession>;
  getManifest(): Promise<PublicationManifest>;
  getNavigation(): Promise<NavigationNode[]>;
  display(locator?: Locator): Promise<void>;
  currentLocator(): Promise<Locator>;
  goTo(locator: Locator): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  setPreferences(preferences: ReadingPreferences): Promise<void>;
  destroy(): Promise<void>;
}
```

Tauri/Rust 负责：安全导入、ZIP/OPF 规范化、资源持久化、语义 block、数据库事务和诊断。WebView 负责：受控加载 XHTML/CSS、排版、用户交互和当前位置观察。

### 4.2 引擎选型 spike（必须先做 ADR-001）

**首选候选：[`johnfactotum/foliate-js`](https://github.com/johnfactotum/foliate-js)。** 先围绕它做可淘汰的 spike；只有出现阻断性问题时，才转向 Readium/epub.js 或自研。

截至本方案编写时核验到的上游事实：

- MIT 许可、纯 ESM、小型模块化、无硬运行依赖；已用于 Foliate 的多个稳定版本；
- 直接提供 EPUB 2/3 解析、嵌套 TOC/page list、EPUB CFI、reflowable paginator、fixed-layout renderer、RTL/page progression、annotation overlayer、progress、search、text walker/TTS 等能力；
- `foliate-view` 可打开 `File`/`Blob`/URL，也允许自定义 book/ZIP loader；这与 Tauri command/resource resolver 的隔离边界匹配；
- 上游 README 明确标注库本身 **API 不稳定且尚无正式 release**，推荐以 git submodule 使用；
- 上游明确警告 scripted EPUB 的同源 `blob:` 风险，要求 CSP 阻止脚本；WebKit sandbox 限制不能被忽略；
- paginator 仍基于 CSS multi-column，存在性能与 CSS 兼容长尾；内置 search 也注明较慢，不能直接替代现有 SQLite 搜索。

因此推荐的集成形态不是把 foliate-js API 散落在组件中，而是：

```text
React ReaderShell
  → EpubAdapter（项目稳定接口）
    → vendored/pinned foliate-js commit
      → TauriPublicationLoader（loadText/loadBlob/getSize）
        → Rust 安全解包、资源白名单、SQLite/import report
```

依赖策略：锁定审核过的 commit（首个 spike 可参考当时 `main` 的 `78914aef...`，正式合入时重新审核），记录 upstream commit 与本地 patch；通过 adapter contract tests 防止升级破坏。submodule、vendored source 或构建时固定 commit 由 ADR-001 决定，禁止跟随浮动 `main`。

比较路线仍保留：

| 路线                       | 优点                                                                    | 风险                                               | spike 验证                                                   |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| A. **foliate-js（首选）**    | 与 Foliate 实战一致；CFI、分页/滚动、fixed-layout、TOC、overlay、text walker 可复用；模块化 | API 未稳定、无 release、需自行集成 zip/loader、WebKit/CSP 风险 | 12 本 fixture、Tauri loader、CSP、字体/图片、CFI/annotation、主题覆盖、内存 |
| B. Readium Web 或 epub.js | 生态/规范积累，可作为退路                                                         | 集成/包体积或维护状态差异，仍需安全与 adapter                      | 仅对 A 的失败项做对照 spike                                         |
| C. 自研 iframe renderer    | 控制力强                                                                  | 易重复踩 EPUB/CSS/CFI/分页坑，成本最高                       | 仅当 A/B 有阻断性问题再选                                            |

**决策门槛**：P0 corpus 通过率、locator 稳定性、安全隔离、维护状态、许可证、包体积、API 可封装性。输出 `docs/adr/001-epub-rendering-engine.md`。

### 4.3 双轨数据模型

建议在现有表旁新增 V2 表，避免原地破坏：

```text
publications
- id, document_id, format, schema_version, rendition_layout
- source_hash, source_path, import_status, imported_at

publication_resources
- id, publication_id, href, media_type, properties
- storage_path/blob_ref, sha256, size, fallback_href

publication_spine
- id, publication_id, resource_id, spine_index
- linear, page_spread, properties

navigation_nodes
- id, publication_id, parent_id, kind, label
- href, fragment, order_index, depth

content_blocks
- id, publication_id, spine_item_id, block_index, kind
- plain_text, language, direction
- cfi, css_selector, text_quote_prefix, text_quote_exact, text_quote_suffix

reading_positions
- publication_id, locator_json, progression, updated_at

import_reports
- publication_id, severity, code, resource_href, message
```

现有 `paragraphs` 在迁移期继续服务旧格式和旧 command；新搜索/AI API 逐步切到 `content_blocks`。不要把完整 XHTML 塞进 `paragraphs.text`。

### 4.4 导入流水线

```text
File selection
  → ZIP safety validation
  → META-INF/container.xml
  → package OPF (metadata/manifest/spine/bindings)
  → nav.xhtml and/or NCX
  → canonical href resolution
  → resource extraction to app data (content-addressed)
  → XHTML DOM parse + sanitize policy
  → semantic block extraction + Locator mapping
  → atomic DB commit
  → cover/metadata available
  → background keyword/embedding index
```

必须处理：

- ZIP Slip、重复路径、压缩炸弹（总大小、单文件大小、压缩比、条目数上限）；
- XML namespace、EPUB 2 NCX、EPUB 3 nav、多 `<rootfile>`；
- 相对 URI、`../`、fragment、percent encoding、base URI；
- spine 中无 TOC 项、TOC 中非 linear 内容；
- CSS `@font-face`、相对 `url()`、图片/SVG；
- 缺失资源、错误 MIME、无效 XML 的可诊断降级；
- encryption.xml：字体混淆可评估支持，DRM 明确拒绝。

### 4.5 渲染与安全边界

- 每个 spine XHTML 在隔离的 iframe/document context 中渲染，避免 publisher CSS 污染 app shell。
- 默认禁用脚本；阻止任意网络请求，外链必须由用户动作交给 shell 打开。
- 用 foliate-js 自定义 loader 对接受控 Tauri commands；优先返回指定 publication 内的资源，不暴露任意文件系统路径。
- `src-tauri/tauri.conf.json` 已建立最小 CSP 和 app-private asset scope 配置基线，并以精确运行时授权兼容旧 PDF；但仍必须用恶意 EPUB 在各 Tauri WebView 验证脚本、外网和危险 embed 确实被阻断，不能仅依赖配置测试或 iframe `sandbox`。
- 禁止 publisher script、inline event handler、`javascript:` URL 和非许可的 frame/object/embed；`connect-src` 默认不允许出版物发起网络请求。
- foliate-js 自身使用 blob/resource document 时，需验证 Tauri macOS WKWebView、Windows WebView2、Linux WebKitGTK 三端 CSP 行为。
- 主题覆盖通过 foliate view/renderer 的受控样式接口或 injected stylesheet 实现，不修改原 XHTML。
- 支持 `Publisher styles` 开关：关闭时使用 reader stylesheet，仍保留语义结构和资源。

### 4.6 Locator 规范

统一 DTO：

```ts
type Locator = {
  href: string;
  type?: string;
  title?: string;
  locations: {
    cfi?: string;
    progression?: number;
    totalProgression?: number;
    position?: number;
    cssSelector?: string;
  };
  text?: { before?: string; highlight?: string; after?: string };
};
```

恢复顺序：CFI → CSS selector + quote → quote match in href → progression → spine item 起点。标注保存 start/end locator，不只保存 `selected_text`。

### 4.7 前后端模块目标

```text
src/features/reader/
├─ ReaderShell.tsx
├─ ReaderToolbar.tsx
├─ ReadingViewport.tsx
├─ navigation/
├─ selection/
└─ adapters/
   ├─ publication.ts
   ├─ epubAdapter.ts
   ├─ pdfAdapter.ts
   └─ markdownAdapter.ts

src/design-system/
├─ tokens.css
├─ primitives/
├─ components/
└─ index.ts

src-tauri/src/publication/
├─ importer.rs
├─ package.rs
├─ navigation.rs
├─ resources.rs
├─ blocks.rs
├─ locator.rs
└─ diagnostics.rs
```

`ReaderContent.tsx` 按能力逐步抽离，不一次性重写：先抽 shell/viewport，再迁 EPUB，之后把 selection/annotation/translation/TTS 接回 adapter events。

---

## 5. Design System v1

### 5.1 设计目标

- **Calm**：低噪声，让长时间阅读不疲劳；
- **Precise**：状态和层级清晰，工具操作可预测；
- **Content-first**：正文与出版物样式优先于品牌装饰；
- **Accessible**：不是后补检查，而是组件默认能力；
- **Themeable**：应用主题与阅读主题分离。

### 5.2 双主题域

#### App Shell Theme

作用于书库、设置、导航、工具面板、弹窗。支持 `light`、`dark`、`system`、`high-contrast`。

#### Reading Theme

作用于出版物 viewport。保留现有 white/paper/mint/sepia/night，但升级为语义 token；额外提供 `publisher` 策略。阅读主题不能改变 app dialog 的可访问性颜色。

### 5.3 Token 层级

禁止组件直接依赖色值；分三层：

1. **Primitive**：灰阶、品牌色阶、尺寸原值；
2. **Semantic**：`surface-canvas`、`text-primary`、`border-subtle`、`action-primary`；
3. **Component**：只有确有必要时，如 `dialog-shadow`。

建议首版 CSS variables：

```css
:root {
  /* color */
  --ds-color-surface-canvas: ...;
  --ds-color-surface-raised: ...;
  --ds-color-surface-sunken: ...;
  --ds-color-text-primary: ...;
  --ds-color-text-secondary: ...;
  --ds-color-text-muted: ...;
  --ds-color-border-subtle: ...;
  --ds-color-border-strong: ...;
  --ds-color-action-primary: ...;
  --ds-color-action-primary-hover: ...;
  --ds-color-focus-ring: ...;
  --ds-color-success: ...;
  --ds-color-warning: ...;
  --ds-color-danger: ...;

  /* typography */
  --ds-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ds-font-reading-serif: Charter, "Source Serif 4", Georgia, serif;
  --ds-font-reading-sans: Inter, system-ui, sans-serif;
  --ds-font-mono: "SFMono-Regular", Consolas, monospace;
  --ds-text-xs: 0.75rem;
  --ds-text-sm: 0.875rem;
  --ds-text-md: 1rem;
  --ds-text-lg: 1.125rem;
  --ds-text-xl: 1.375rem;

  /* spacing: 4px base */
  --ds-space-1: 0.25rem;
  --ds-space-2: 0.5rem;
  --ds-space-3: 0.75rem;
  --ds-space-4: 1rem;
  --ds-space-6: 1.5rem;
  --ds-space-8: 2rem;

  /* shape/elevation/motion */
  --ds-radius-sm: 0.375rem;
  --ds-radius-md: 0.625rem;
  --ds-radius-lg: 0.875rem;
  --ds-shadow-popover: ...;
  --ds-duration-fast: 120ms;
  --ds-duration-normal: 180ms;
}
```

阅读域追加：

```css
[data-reading-theme] {
  --reader-bg: ...;
  --reader-text: ...;
  --reader-muted: ...;
  --reader-link: ...;
  --reader-selection: ...;
  --reader-highlight: ...;
  --reader-font-family: var(--ds-font-reading-serif);
  --reader-font-size: 18px;
  --reader-line-height: 1.75;
  --reader-measure: 68ch;
}
```

### 5.4 排版规范

- UI 正文默认 14–16px；正文阅读默认 18px，用户可调 12–32px；
- 阅读行长默认 60–75 个拉丁字符；CJK 以视觉宽度评估，禁止只用固定 `em` 猜测；
- 正文行高默认 1.65–1.8；标题采用紧凑行高；
- 支持 serif/sans/system/publisher font；内嵌字体加载失败要 fallback；
- 使用逻辑属性和 `dir`，支持 RTL；为 vertical writing 预留 token/API，不在 P0 强行实现；
- 不用 emoji 作为唯一图标或状态表达；统一 SVG icon + 可访问名称。

### 5.5 布局规范

- App Shell：顶栏 44–52px；可折叠侧栏；正文 viewport 永远保留最小可读宽度；
- viewport < 900px 时工具面板改 overlay，不再同时挤压双侧栏；
- 阅读模式只显示必要导航，鼠标/键盘唤出工具；
- 所有 resize handle 至少有 8px 命中区域，并提供键盘调整方式；
- 弹层必须有 focus trap、Escape、返回焦点和 viewport 边界处理。

### 5.6 基础组件清单与完成定义

第一批：

- `Button` / `IconButton`
- `TextField` / `SearchField` / `Select` / `Switch` / `Slider`
- `Tabs` / `SegmentedControl`
- `Dialog` / `Popover` / `Tooltip` / `Menu`
- `Toast` / `InlineAlert` / `Progress`
- `Panel` / `ResizablePanel` / `EmptyState` / `Skeleton`
- `Toolbar` / `ReaderToolbar`

每个组件必须具备：

- variants、sizes、禁用/加载/错误状态；
- 键盘行为和 ARIA 约定；
- light/dark/high-contrast 截图；
- focus-visible；
- 单元/交互测试；
- 示例页面（建议用轻量内部 `/design-system` dev route，是否引入 Storybook 在 ADR 决定）。

### 5.7 可访问性基线

- 目标：WCAG 2.2 AA（桌面应用适用项）；
- 正常文字对比度 ≥ 4.5:1，大字 ≥ 3:1；焦点指示器可见；
- 支持 `prefers-reduced-motion`；
- 语义 heading/landmark，不用纯 `<div>` 模拟按钮；
- TOC 作为 tree/navigation 可读，当前项使用 `aria-current`；
- 字号、行高、内容宽度、颜色不是唯一信息载体；
- 文本选择 popover 支持键盘进入和关闭，不能依赖 mouseup；
- 发布物 iframe 与 app 之间定义清晰的焦点转移协议。

### 5.8 代码治理

- 删除 `src/App.css` 中 Vite 模板全局规则，避免污染所有 button/input；
- Tailwind 可保留作布局工具，但颜色/圆角/阴影通过 token 映射；
- ESLint/CI 增加规则或脚本：新代码禁止硬编码 hex/rgb（token 定义文件除外）；
- 新功能先用 DS 组件；旧界面采用“触达即迁移”，不一次性视觉重写；
- 设计变更需附状态矩阵与键盘行为，不只给静态截图。

---

## 6. 状态、接口与错误模型

### 6.1 前端状态分层

- **Server/persistent state**：documents、manifest、navigation、blocks、annotations；通过 repository/query hooks 管理；
- **Session state**：当前 publication session、locator、selection、panel state；
- **Preferences**：app theme、reading preferences、shortcuts；
- **Ephemeral UI**：dialog/popover/loading；尽量组件本地化。

Zustand 不再作为所有异步数据和 UI 状态的单体容器。按 domain 建 store/selectors，组件按需订阅。

### 6.2 Tauri DTO

新增命令采用版本化对象参数和稳定错误：

```json
{
  "error": {
    "code": "publication.resource_missing",
    "message": "Image resource is missing",
    "details": { "href": "images/cover.jpg" },
    "recoverable": true
  }
}
```

建议新命令：

- `publication_import_v2`
- `publication_get_manifest_v2`
- `publication_get_navigation_v2`
- `publication_resolve_resource_v2`
- `publication_get_blocks_v2`
- `reading_position_get_v2` / `reading_position_save_v2`
- `annotation_create_v2` / `annotation_list_v2`

不要原地改变旧 command 返回结构；迁移完成后再废弃。

---

## 7. 测试与兼容性工程

### 7.1 Fixture corpus

仓库只提交可合法再分发的小型 fixture，较大公开 corpus 在 CI 下载并校验 hash。

| 类别     | 必含用例                                                  |
| ------ | ----------------------------------------------------- |
| EPUB 2 | NCX、短 TOC、无封面、嵌套目录、非 ASCII 路径                         |
| EPUB 3 | nav.xhtml、多个 nav、landmarks、page-list                  |
| 内容     | heading/list/table/blockquote/code/ruby/footnote/link |
| 资源     | jpg/png/webp/svg、内嵌字体、CSS import、相对 URL               |
| 排版     | publisher CSS、RTL、混合语言、长章节                            |
| 布局     | reflowable；fixed-layout 作为 P1 expected limitation     |
| 容错     | 缺资源、错误 MIME、坏 fragment、畸形 XHTML                       |
| 安全     | Zip Slip、压缩炸弹、script、外链资源、危险 URL                      |
| 定位     | CFI、搜索跳转、重启恢复、主题/字号变化后标注恢复                            |

优先采用 EPUBCheck 官方/社区合法样本与自建最小 fixture，并记录来源和许可证。

### 7.2 测试金字塔

1. **Rust unit**：URI 规范化、OPF/nav/NCX、ZIP limits、block/locator；
2. **Rust integration**：fixture → DB snapshot/import report；
3. **TS unit**：adapter、locator fallback、preference mapping；
4. **Component**：TOC、toolbar、dialog、selection、loading/error；
5. **E2E（Tauri）**：导入 → 阅读 → 跳转 → 标注 → 重启恢复；
6. **Visual regression**：关键 fixture × app/reader themes × viewport；
7. **Accessibility**：axe + 手工键盘/VoiceOver 冒烟。

### 7.3 每阶段质量门槛

- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust parser/migration tests
- 前端 unit/component tests
- P0 corpus compatibility report
- 关键流程 E2E
- 无新增严重 axe issue
- 性能预算不回退超过 10%

在测试脚手架建立前，功能开发不得宣称“兼容完成”。

---

## 8. 迁移策略

### 8.1 原则

- 新旧表和 command 并行，使用 feature flag `publication_engine_v2`；
- 原文件不移动、不覆盖；所有重导入从用户原 EPUB 读取；
- 迁移失败保留 V1 数据并生成报告；
- 每个 schema migration 可重入，先备份数据库；
- 不依赖一次性前端 localStorage 转换完成关键数据迁移。

### 8.2 数据迁移

1. 为每个现有 EPUB 计算 source hash；
2. 若源文件仍存在，导入 V2 publication；
3. 通过 `href + paragraph text quote` 将旧 paragraph 映射到新 block；
4. 阅读位置映射到最近 block；
5. 标注以 selected text + 周边 quote 重定位；无法定位的标注进入“待修复”，不能删除；
6. embedding 可继续引用旧 paragraph，后台为 content block 重建；
7. 用户验收并达到遥测替代指标（本项目 local-first，可仅本地展示报告）后再移除 V1 路径。

### 8.3 回滚

- feature flag 可切回 V1 renderer；
- V2 schema 只新增，不在稳定前 drop V1 表；
- 数据库升级前创建带 schema version 的备份；
- 任何迁移异常必须中止事务并展示恢复入口。

---

## 9. 分阶段实施路线

工期以 1–2 名工程师估算；每个阶段都可独立验收。

### Phase 0 — 基线与决策（1–2 周）

- 冻结 EPUB 兼容性症状补丁；
- 建 fixture corpus、兼容报告模板、性能采样；
- 完成 ADR-001 renderer 选型、ADR-002 resource storage、ADR-003 locator；
- 建立 V2 feature flag 和 DB backup/migration 框架；
- 输出 10 本代表性 EPUB 的当前基线。

**退出门槛**：选型 spike 能打开 corpus、加载本地资源、报告当前位置；方案和 ADR 审核通过。

### Phase 1 — Design System 基础（1–2 周，可与 Phase 0 后半并行）

- 建 `src/design-system/tokens.css` 和主题切换；
- 实现 Button/IconButton/Input/Dialog/Popover/Tabs/Panel；
- 建 DS showcase 和 accessibility checks；
- 清理 Vite 模板全局 CSS；
- 先迁 Reader toolbar、空状态、loading/error，不先迁全部 Settings。

**退出门槛**：核心 primitives 状态完整，light/dark/high-contrast 和键盘验证通过。

### Phase 2 — Publication Import V2（2–4 周）

- 实现安全 ZIP、OPF、manifest/spine、nav/NCX、resource resolver；
- 新 schema + transaction + import report；
- semantic block + locator mapping；
- parser/integration tests。

**退出门槛**：P0 导入 corpus ≥ 98%，无静默空章节，安全 fixtures 通过。

### Phase 3 — EPUB 阅读闭环（3–5 周）

- 实现 `EpubAdapter`、isolated renderer、TOC、连续/分页阅读；
- publisher/reader style、主题、字体、字号、行高、宽度；
- locator 保存/恢复；
- 外链、脚注、图片、表格、SVG；
- keyboard 和 screen reader 基线。

**退出门槛**：导入 → 阅读 → 导航 → 重启恢复 E2E 通过；P0 visual baseline 通过。

### Phase 4 — 阅读能力迁移（2–4 周）

- 搜索跳转、选区、标注 re-anchor；
- TTS block/句子定位；
- 翻译、双语、摘要接入 content blocks；
- Tool workspace 使用 DS；
- 拆除 `ReaderContent.tsx` 中 EPUB 特判。

**退出门槛**：AI 不可用时核心阅读不受影响；locator 在各能力间一致。

### Phase 5 — 旧数据迁移与发布（2–3 周）

- 批量重导入、标注/位置迁移、embedding 重建队列；
- 用户可见迁移报告和回滚；
- 性能、内存、a11y、安全审计；
- beta → 分批默认启用 → V1 deprecation。

**退出门槛**：迁移成功率和错误处理达标，连续两个版本无 P0 数据丢失问题。

### Phase 6 — 长尾能力（按需求）

- fixed-layout、vertical writing、media overlays；
- 重新评估 PDF/Markdown adapter；
- 移除 V1 schema/path（单独 migration release）。

---

## 10. 建议的首批 backlog

### Epic A — Compatibility Lab

- A1：收集并登记 fixture 来源/许可证；
- A2：实现 `epub-inspect` Rust test helper；
- A3：生成 JSON/Markdown compatibility report；
- A4：记录 import/open/navigation/visual/locator 指标。

### Epic B — foliate-js Engine Spike

- B1：固定 foliate-js commit，建立最小 Tauri `foliate-view` 页面；
- B2：实现 `TauriPublicationLoader`（`loadText/loadBlob/getSize`），验证不把整本书常驻内存；
- B3：维持最小 CSP / asset scope 配置，并使用 scripted/malicious EPUB 完成跨平台 WebView 验证；
- B4：验证 EPUB 2/3 TOC、CFI、relocate、paginated/scrolled、RTL、fixed-layout；
- B5：用 overlayer + CFI range 做标注原型，用 text walker 做 TTS/selection 原型；
- B6：验证 publisher/reader theme、字体混淆所需 SHA-1、安全上下文；
- B7：记录 API wrapper、commit 更新流程、patch 和 upstream 风险，形成 ADR 结论。

### Epic C — Design System Foundation

- C1：语义 token + app themes；
- C2：reader theme token migration；
- C3：Button/Input/Dialog/Popover/Tabs/Panel；
- C4：showcase + visual/a11y tests；
- C5：Reader toolbar 试点迁移。

### Epic D — Publication Model

- D1：V2 schema migration；
- D2：OPF/nav/NCX parser；
- D3：resource storage；
- D4：semantic block/locator；
- D5：import report。

### Epic E — Reader Shell

- E1：`PublicationAdapter`；
- E2：ReaderShell/Viewport/Navigation；
- E3：position persistence；
- E4：selection/annotation bridge；
- E5：search/TTS/translation bridge。

---

## 11. 风险与应对

| 风险                    | 影响                        | 应对                                                  |
| --------------------- | ------------------------- | --------------------------------------------------- |
| 第三方 renderer 维护不足     | 被锁定、标准长尾难修                | adapter 隔离；spike + ADR；保留替换能力                       |
| WebView 平台差异          | macOS/Windows/Linux 渲染不一致 | CI/发布前 smoke matrix；视觉 fixture                      |
| publisher CSS 与用户主题冲突 | 内容不可读                     | iframe 隔离；publisher/reader mode；最小强制 a11y overrides |
| 数据模型迁移破坏标注            | 用户数据损失                    | append-only schema、备份、quote re-anchor、待修复列表         |
| AI 功能拖慢首屏             | 阅读不可用                     | indexing/AI 后台化，核心阅读不等待模型                           |
| 重构范围过大                | 长期无可发布版本                  | feature flag、阶段退出门槛、按 vertical slice 合并             |
| 恶意 EPUB               | 文件读取、DoS、网络泄漏             | ZIP limits、sanitization、CSP、禁脚本/外网、fuzz tests       |
| DS 变成“大改皮肤”           | 延误内核且无复用价值                | primitives + Reader 试点，触达即迁移，不全量重画                  |

---

## 12. 决策清单（实施前必须关闭）

1. **ADR-001**：foliate-js 采用/淘汰结论、固定 commit 与 vendor/submodule 策略；
2. **ADR-002**：resource 存储及 foliate-js loader 边界（解压目录、content-addressed、或受控流式）；
3. **ADR-003**：Locator/CFI 生成与恢复策略；
4. **ADR-004**：XHTML sanitization、CSP、外链策略；
5. **ADR-005**：前端测试栈和 visual regression；
6. **ADR-006**：DS showcase（内部 route 或 Storybook）；
7. **ADR-007**：旧标注/embedding 迁移与 V1 退役门槛。

默认建议只有在 spike 未发现阻断时生效：**foliate-js + EpubAdapter**、TauriPublicationLoader + app data 中受控资源、CFI + text quote 双锚点、iframe 禁脚本与禁外网。

---

## 13. Definition of Done：V2 首个稳定版

只有同时满足以下条件，才能称为“EPUB 重构完成”：

- [ ] 项目目标、非目标和 P0/P1/P2 支持矩阵已在 README/用户文档公开；
- [ ] P0 corpus 导入成功率 ≥ 98%，关键结构用例 100% 通过；
- [ ] EPUB 不再经过纯文本 regex flattening 作为阅读来源；
- [ ] 原始资源和 semantic block 双轨模型上线；
- [ ] TOC 保留层级，短 TOC 不再被 spine 覆盖；
- [ ] 进度、搜索、标注、TTS、翻译使用统一 locator；
- [ ] 主题/字体/字号变化后位置与标注可恢复；
- [ ] 核心 Reader UI 使用 Design System tokens/primitives；
- [ ] 键盘、对比度、200% 缩放、reduced motion 验收通过；
- [ ] 恶意 ZIP/XHTML 安全测试通过，无任意外网加载；
- [ ] 旧数据迁移可回滚，失败不删除原数据；
- [ ] `npm run build`、Rust checks/tests、E2E、visual/a11y gates 全部通过；
- [ ] V1 renderer 退役前至少经过一个公开 beta 周期。

---

## 14. 下一步（立即执行顺序）

1. 创建 `refactor/foliate-js-spike`，固定上游 commit，只做 renderer/loader/CSP/CFI spike；
2. 用 scripted EPUB 在 Tauri WebView 证明当前 CSP 基线可阻断脚本和外网，并记录平台差异；
3. 建 `tests/fixtures/epub/manifest.json`，先放 8–12 个最小合法 fixture；
4. 记录当前 parser 在 corpus 上的失败基线；
5. 编写 ADR-003～004，并按实证更新已完成的 ADR-001/002；
6. 并行建立 Design System token 和 5 个 primitives，以 Reader toolbar 为试点；
7. ADR 通过后才开始 V2 schema 与正式 importer。

这套顺序保证重构从“目标和验证标准”开始，而不是从依赖或页面样式开始；同时用小型 spike 尽早验证最大技术风险。
