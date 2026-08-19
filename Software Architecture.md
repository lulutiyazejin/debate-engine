## 1. 目录结构总览

```
debate-engine/
├── Software Architecture.md   # 本文件：目录结构 + 行数红线 + 演进纪律
├── ARCH-debate-engine.md      # 核心架构决策文档（功能/数据/API 设计，1060 行）
├── ARCH-UI-reference.md       # UI 规范与组件参考（967 行）
├── PLAN-*.md                  # 版本计划台账
│
├── app/                       # Tauri 桌面前端（唯一 UI 端）
│   ├── src/                   # React 18 + TypeScript
│   │   ├── App.tsx            # 布局骨架与状态装配（枢纽，≤350 行目标）
│   │   ├── hooks/
│   │   │   ├── useRebuttal.ts       # 反驳生成状态：论点输入/立场/风格/流式输出
│   │   │   ├── useKnowledge.ts      # 知识库状态：文档列表/立场分类/计数
│   │   │   ├── useSearch.ts         # 搜索状态：多模式检索/筛选器/分页
│   │   │   ├── useIngestion.ts      # 入库状态：队列/阶段进度/失败重试
│   │   │   ├── useModelStatus.ts    # 模型状态：API 配额用量/Ollama 在线/BGE-M3 加载
│   │   │   ├── useTauriListen.ts    # Tauri 事件订阅（handler 走 ref，只订阅一次）
│   │   │   ├── useAppShortcuts.ts   # 全局快捷键装配
│   │   │   ├── useHistory.ts        # 辩论历史：会话列表/加载/删除
│   │   │   └── useDebounce.ts       # 通用防抖 hook（搜索框/滑块）
│   │   ├── features/
│   │   │   ├── RebuttalPanel.tsx    # 反驳主面板：输入区/立场风格选择器/输出区（枢纽，≤350）
│   │   │   ├── ArgumentInput.tsx    # 论点输入框 + ParsedArgument 结构化预览
│   │   │   ├── StanceSelector.tsx   # 立场/风格/格式三选择器（独立，可复用）
│   │   │   ├── RebuttalOutput.tsx   # 反驳输出：流式文本/引用列表/操作按钮
│   │   │   ├── CitationCard.tsx     # 单条引用卡片：来源/页码/原文片段/跳转按钮
│   │   │   ├── KnowledgeBase.tsx    # 知识库主视图：分组列表/搜索/立场筛选
│   │   │   ├── DocumentViewer.tsx   # 文档查看器：PDF.js/MD渲染/关键词高亮跳页
│   │   │   ├── IdeologyCube.tsx     # 3D 意识形态立方体（React Three Fiber）
│   │   │   ├── SearchPanel.tsx      # 高级搜索面板：四模式/滑块筛选/坐标范围
│   │   │   ├── IngestionFlow.tsx    # 导入向导：文件选择/立场确认/进度/失败重试
│   │   │   ├── SkillEditor.tsx      # Skill 文件编辑器：立场/入库 Skill 的 MD 编辑
│   │   │   ├── DebateHistory.tsx    # 辩论历史：会话时间线/重放/删除
│   │   │   ├── DraftBook.tsx        # 备稿本：已保存反驳的集合/导出
│   │   │   ├── SettingsPage.tsx     # 设置页装配（左导航+右内容，scroll-spy；≤300）
│   │   │   ├── settings/
│   │   │   │   ├── LocalModelSection.tsx   # BGE-M3：下载/GPU加速/自检/下载源/代理
│   │   │   │   ├── ApiProviderSection.tsx  # AI 服务商：API Key/配额用量/降级链/自定义端点
│   │   │   │   ├── StorageSection.tsx      # 存储路径/迁移/云备份 S3/R2 配置
│   │   │   │   ├── ShortcutsSection.tsx    # 快捷键捕获与绑定
│   │   │   │   ├── PrivacySection.tsx      # 日志隐私级别/Gemini 敏感提示/离线模式
│   │   │   │   ├── DiagSection.tsx         # 健康检查/诊断报告/日志管理
│   │   │   │   └── AboutSection.tsx        # 版本信息/数据目录
│   │   │   └── onboarding/
│   │   │       ├── WelcomeScreen.tsx        # 新手引导第一屏（三步流程；dev_skip_onboarding=true 时跳过）
│   │   │       └── DemoKnowledge.tsx        # 演示知识库加载器
│   │   ├── components/            # 无状态通用组件
│   │   │   ├── Toast.tsx          # 三类通知（success/error/warning + 操作按钮）
│   │   │   ├── ConfirmDialog.tsx   # 确认弹窗（标准版 + dangerMode checkbox 版）
│   │   │   ├── ContextMenu.tsx    # 右键菜单（边界检测版）
│   │   │   ├── VirtualGrid.tsx    # 虚拟滚动网格（大列表性能）
│   │   │   ├── StreamingText.tsx  # 流式文本显示（反驳生成边输出边显示）
│   │   │   ├── ProgressBar.tsx    # 底部任务进度条（暂停/继续/取消）
│   │   │   └── QuotaBar.tsx       # 底部状态栏：各服务商配额用量（白/黄/红三色）
│   │   ├── api/
│   │   │   ├── index.ts           # invoke 封装（rebuttal/knowledge/ingestion/settings）
│   │   │   └── types.ts           # TypeScript DTO（与 Python Pydantic 对应）
│   │   ├── lib/
│   │   │   ├── pdfViewer.ts       # PDF.js 封装：加载/跳页/关键词高亮
│   │   │   ├── usePersistedState.ts  # localStorage 持久化 state hook
│   │   │   ├── format.ts          # 文件大小/日期/token 数格式化
│   │   │   └── pinyin.ts          # 拼音搜索匹配（设置页搜索）
│   │   ├── i18n/
│   │   │   ├── zh.ts              # 中文文案
│   │   │   ├── en.ts              # 英文文案
│   │   │   └── index.ts           # makeT 点路径取值
│   │   └── styles/
│   │       ├── app.css            # @import 聚合入口
│   │       ├── theme.css          # CSS 变量：颜色/字体/间距
│   │       ├── base.css           # Reset + 全局基础样式
│   │       ├── layout.css         # 三栏布局/侧边栏/主内容区
│   │       ├── panels.css         # 卡片/面板/分区样式
│   │       ├── rebuttal.css       # 反驳面板专属样式
│   │       ├── knowledge.css      # 知识库视图样式
│   │       ├── cube.css           # 3D 立方体容器样式
│   │       ├── settings.css       # 设置页样式
│   │       ├── overlays.css       # 弹窗/灯箱/遮罩层
│   │       └── toast.css          # Toast 动画
│   └── src-tauri/
│       ├── tauri.conf.json
│       ├── Cargo.toml
│       ├── capabilities/default.json   # Tauri 2 权限（shell/opener/fs）
│       └── src/
│           ├── main.rs            # 装配各层、invoke_handler、sidecar 启动（≤350）
│           ├── model.rs           # 跨层 DTO（Rust↔Python 共用结构）
│           ├── command/           # Tauri 命令层（薄封装，参数 camelCase）
│           │   ├── rebuttal.rs    # 反驳生成/ParsedArgument 解析
│           │   ├── knowledge.rs   # 知识库 CRUD/搜索/立场查询
│           │   ├── ingestion.rs   # 文档导入/队列状态/断点恢复
│           │   ├── models.rs      # BGE-M3 下载/验证/GPU状态/代理检测
│           │   ├── settings.rs    # 设置读写/日志管理/诊断检查
│           │   └── viewer.rs      # 文档查看器：打开文件/打开文件夹/PDF跳页
│           └── service/
│               ├── sidecar.rs     # Python FastAPI 子进程管理：启动/健康检测/重启
│               ├── proxy.rs       # HTTP 反向代理：Tauri→FastAPI（localhost:7700）
│               └── logging.rs    # 按天分文件日志（JSONL，五类）
│
└── backend/                   # Python FastAPI sidecar（AI 引擎）
    ├── main.py                # FastAPI 入口，路由注册，启动检查（≤100）
    ├── config.py              # 配置管理：API Key/模型/路径/日志级别
    ├── api/                   # 路由层（薄封装，参数验证）
    │   ├── rebuttal.py        # POST /api/rebuttal
    │   ├── import_doc.py      # POST /api/import  POST /api/import/confirm
    │   ├── knowledge.py       # GET  /api/knowledge/*
    │   ├── stances.py         # GET  /api/stances  /api/skills
    │   └── diagnostics.py     # GET  /api/health   /api/diag
    ├── engine/                # 核心推理引擎
    │   ├── argument_parser.py # 论点→ParsedArgument 结构化（core_claim/conditions/attack_surface）
    │   ├── stance_router.py   # 立场路由：坐标距离计算/检索范围决策
    │   ├── retriever.py       # 混合检索：FTS5 + LanceDB 向量 + RRF 融合
    │   ├── reranker.py        # 立场精排：按 Skill 文件偏好调整权重
    │   └── rebuttal_engine.py # 反驳生成：Skill Prompt 注入/防幻觉/流式输出
    ├── ingestion/             # 文档入库流水线
    │   ├── detector.py        # 文档类型检测（PDF/Word/Excel/URL/学术论文）
    │   ├── parser_pdf.py      # Docling PDF 解析（结构保留/OCR备用）
    │   ├── parser_docx.py     # python-docx Word 解析（标题层级）
    │   ├── parser_excel.py    # 表格→自然语言描述（openpyxl + LLM）
    │   ├── parser_url.py      # trafilatura 网页正文提取
    │   ├── chunker.py         # 目录/标题优先切割 + 语义边界检测备用
    │   ├── summarizer.py      # 分层摘要：章节→Map-Reduce→全书分析
    │   ├── classifier.py      # 立场自动分类：向量相似度 + LLM 辅助
    │   └── indexer.py         # 向量化 + SQLite 写入 + LanceDB 写入 + INDEX.md 更新
    ├── models/                # AI 模型适配层
    │   ├── llm_client.py      # LLM API 统一适配（OpenAI 格式，多提供商）
    │   ├── model_router.py    # 模型路由器：任务→优先级链→自动降级
    │   └── embedder.py        # BGE-M3 本地嵌入（异步批量，int8 量化）
    ├── storage/               # 数据访问层
    │   ├── sqlite_store.py    # SQLite 读写（documents/chunks/arg_units/relations/FTS5）
    │   ├── lance_store.py     # LanceDB 向量读写（版本绑定/级联删除）
    │   └── skill_loader.py    # Skill 文件解析与缓存（立场/入库两套）
    └── logging/               # 结构化日志（JSONL，trace_id 贯穿）
        ├── api_calls.py       # API 调用日志（provider/tokens/latency/fallback）
        ├── ingestion.py       # 入库流程日志（Trace-Span 层次）
        ├── retrieval.py       # 检索质量日志（RAG 四维评分）
        ├── behavior.py        # 用户行为日志（copied/retried/saved）
        └── errors.py          # 错误日志（永久保留，trace_id 关联）

knowledge_base/                # 知识库数据目录（运行时，用户管理）
├── stances/                   # 按立场分类的文档目录
│   ├── liberal/               # 古典自由主义
│   ├── marxist/               # 马列毛主义
│   ├── conservative/          # 保守主义
│   ├── social_democracy/      # 社会民主主义
│   ├── empirical/             # 经验主义/数据派
│   └── [用户自建立场]/
├── shared/                    # 跨立场共享资料（事实、数据、历史）
├── inbox/                     # 待分类暂存区
├── INDEX.md                   # 全局索引（自动维护）
├── skills/
│   ├── stances/               # 辩论立场 Skill（预置 5 个）
│   │   ├── liberal.skill.md
│   │   ├── marxist.skill.md
│   │   ├── conservative.skill.md
│   │   ├── social_democracy.skill.md
│   │   └── empirical.skill.md
│   └── ingestion/             # 文档类型入库 Skill（预置 5 个）
│       ├── political_theory.skill.md
│       ├── academic_paper.skill.md
│       ├── news_article.skill.md
│       ├── historical_document.skill.md
│       └── default.skill.md
├── vector_store/              # LanceDB 数据目录（可指向 S3/R2）
└── logs/                      # 六类 JSONL 日志（按天轮转）
    ├── api_calls.jsonl
    ├── ingestion.jsonl
    ├── retrieval.jsonl
    ├── behavior.jsonl
    ├── errors.jsonl
    └── system.jsonl
```

---

## 2. 文件行数红线

| 类型 | 预警 | 强拆 |
|---|---|---|
| 枢纽装配（App.tsx / main.py / main.rs） | 300 | 400 |
| 前端 feature 组件 | 250 | 350 |
| React hooks | 150 | 200 |
| components/ 通用组件 | 150 | 200 |
| lib/ 工具 | 150 | 250 |
| api/index.ts 封装层 | 200 | 300 |
| CSS（按域拆） | 250 | 350 |
| i18n 字典 | — | 600 |
| Python API 路由层 | 80 | 120 |
| Python engine 模块 | 200 | 300 |
| Python ingestion 模块 | 150 | 250 |
| Python storage/models 模块 | 150 | 250 |
| Rust command 层 | 100 | 180 |
| Rust service 层 | 250 | 350 |
| Skill 文件（.skill.md） | — | 300 |
| ARCH/PLAN 文档 | — | 800 |

**规则**：越强拆线立即拆或走豁免（登记原因+复审版本）。内聚优先行数；切面按职责不按行数；每个拆出文件须一句话说清职责。

**演进纪律（新功能优先新建文件，减少事后重构）**：

1. **新能力→新文件**：新功能/新职责默认新建 hook（`hooks/useXxx.ts`）/ Python 模块 / feature 组件，不塞进既有文件。开闭原则——对扩展开放、对修改克制。
2. **枢纽只做装配**：`App.tsx` / `main.py` / `main.rs` 只保留「引入 + 接线」，业务逻辑不落地在枢纽；新功能的接线尽量薄（一次 hook 调用 + 一处 JSX/handler 注入）。
3. **预警线即动手**：文件一旦承担 2+ 职责或触预警线就趁小拆分，成本远低于逼近强拆线时的紧急大重构。
4. **Python 路由层最薄**：`api/*.py` 只做参数验证和调用 engine，业务逻辑全部在 `engine/`，路由层超 80 行即检查是否混入了业务逻辑。
5. **Skill 文件是配置，不是代码**：`.skill.md` 的新增/修改不走代码评审，但必须经过人工测试（生成一次反驳验证效果）后才合入知识库。

---

## 3. 关键依赖与技术边界

| 层次 | 技术选型 | 版本约束 | 备注 |
|---|---|---|---|
| 前端框架 | Tauri 2.x + React 18 + TypeScript | Tauri ≥ 2.0 | 已有 bili-comment-marker 开发经验 |
| 3D 可视化 | @react-three/fiber + @react-three/drei | latest | IdeologyCube 组件专用 |
| PDF 查看器 | PDF.js（Mozilla 开源） | latest | 内嵌 DocumentViewer |
| Python 后端 | FastAPI + uvicorn | Python ≥ 3.11 | sidecar 进程，localhost:7700 |
| 向量数据库 | LanceDB（本地/S3 双模式） | ≥ 0.6 | int8 量化，原生 S3 备份 |
| 元数据数据库 | SQLite + FTS5 + jieba 分词 | 内置 | sqlite-simple-tokenizer |
| 文档解析 | Docling（IBM 开源） | ≥ 2.0 | 本地运行，结构感知 PDF 解析 |
| 嵌入模型 | BGE-M3（本地，ONNX） | bge-m3 v1.5 | 1024 维，中英双语，绑定版本号 |
| LLM 接口 | 统一 OpenAI 格式适配层 | — | Groq/Gemini/Cerebras/Ollama/自定义 |
| 云备份同步 | Litestream（SQLite）+ LanceDB S3 | — | Cloudflare R2 推荐 |

---

## 4. 数据流边界

```
用户输入论点
  ↓ Tauri invoke
  ↓ command/rebuttal.rs（薄转发）
  ↓ HTTP POST /api/rebuttal（localhost:7700）
  ↓ engine/argument_parser.py → ParsedArgument
  ↓ engine/stance_router.py → 检索范围
  ↓ engine/retriever.py → FTS5 + LanceDB 混合检索
  ↓ engine/reranker.py → Skill 偏好精排
  ↓ engine/rebuttal_engine.py → LLM（流式）
  ↓ SSE 流式回传 → StreamingText.tsx 边生成边显示
  ↓ 完成后 logging/retrieval.py 写入质量评分
```

```
文档导入
  ↓ IngestionFlow.tsx 拖拽/选文件
  ↓ command/ingestion.rs → 传文件路径给 Python
  ↓ ingestion/detector.py → 类型识别 → 选对应 parser
  ↓ ingestion/chunker.py → 目录/标题切割（本地，免费）
  ↓ models/embedder.py → BGE-M3 向量化（本地，免费）
  ↓ ingestion/summarizer.py → 章节摘要（免费 API）
  ↓ ingestion/classifier.py → 立场自动分类
  ↓ 前端人工确认弹窗（必须步骤）
  ↓ ingestion/indexer.py → SQLite + LanceDB 写入 + INDEX.md 更新
  ↓ logging/ingestion.py → Trace-Span 日志
```

---

## 5. 待拆/豁免清单（V1.0 基线）

> 项目初始化阶段，以下文件预计超线，需在 V1.1 跟进处理。

| 文件 | 预估行数 | 上限 | 处置 | 复审版本 |
|---|---|---|---|---|
| `app/src/features/RebuttalPanel.tsx` | ~400 | 350（枢纽） | 考虑拆出 `ArgumentInput.tsx` / `RebuttalOutput.tsx` | V1.1 |
| `backend/engine/rebuttal_engine.py` | ~320 | 300 | 考虑拆出 prompt 构建为 `prompt_builder.py` | V1.1 |
| `backend/ingestion/summarizer.py` | ~280 | 250 | Map-Reduce/Refine/Gemini 三策略可各自独立文件 | V1.1 |
| `app/src/features/IdeologyCube.tsx` | ~350 | 250（feature） | 3D 渲染逻辑拆出为 `lib/cubeRenderer.ts` | V1.1 |
| `knowledge_base/skills/stances/marxist.skill.md` | ~200 | 300 | OK，暂无需处理 | — |

**紧急程度排序（V1.0 基线）**：RebuttalPanel.tsx（主流程枢纽，最先触预警）＞ rebuttal_engine.py（核心逻辑膨胀风险高）＞ IdeologyCube.tsx（3D 渲染天然复杂）＞ summarizer.py（三策略分支容易混写）

---

## 6. 0.1.3 架构变更（详见 PLAN-0.1.3.md）

| 子系统 | 变更 | 边界说明 |
|---|---|---|
| 窗口层 | 无外框（decorations:false）+ 功能条拖动区 + 自绘控制钮 | Tauri 配置 + capabilities 补权；贴边分屏失效接受 |
| 存储层 | documents +6 元数据列；ALTER 迁移 + upsert 列清单三处同改 | sqlite_store 单点；分享包同步受益 |
| 联网补充层 | 新增 `web_enrich.py`（wiki 中→英→百科→bing，每级 3s，手动标优先） | 独立模块，失败不阻塞入库；走代理层 |
| 代理层 | settings.json proxy 三态；httpx 统一注入；127.0.0.1 bypass | 模型/维基/百科全部外发请求经此 |
| 模型层 | ollama 适配器（探测/拉起/pull/下载立即生效）+ 任务映射表 | 复用 effective_task_chains/provider_models 热生效 |
| 立场体系 | skills/stances 目录扫描自动发现；17 预置 + 手动导入端点 | skill_loader 热加载；前端零硬编码 |
| 字体递送 | 引擎 StaticFiles 递 fonts\；前端 FontFace 动态注册 | 不进安装包；报告 HTML 不受影响 |
| 视觉层 | tokens v5 + G6 换皮 + 交互词汇常量 | 硬编码色值白名单制；样张 design-preview-frameless.html |

行数管理影响：`web_enrich.py` 与 ollama 适配器新文件各 ≤250 行；`sqlite_store.py` 元数据扩展后若越线，拆 `migrations.py`（批 E 复审）。
