# PLAN-0.1.0 · 核心引擎（Python 后端 CLI 验证阶段）

> 版本定位：0.1.0 是第一个可运行版本，目标是在命令行环境下验证完整的 RAG 反驳链路——
> 导入一篇文档 → 输入一个论点 → 输出一条带引用的反驳。不含桌面 UI，不含 Tauri。
>
> 源码路径：`debate-engine/backend/`（待初始化）
> 参考架构：`ARCH-debate-engine.md`（全量）

---

## 版本概述

本版本共 11 个项目，按层次顺序推进：

| 批次 | 项目 | 说明 |
|---|---|---|
| 批1 | 项目1 | 环境初始化（最先，其余全部依赖） |
| 批2 | 项目2、3 | 存储层 + BGE-M3（后续全部依赖） |
| 批3 | 项目4、5 | 模型路由器 + Skill 文件（并行，无依赖） |
| 批4 | 项目6、7 | 文档解析 + 分块（并行，无依赖） |
| 批5 | 项目8 | 入库流水线（依赖批2-4全部完成） |
| 批6 | 项目9 | 核心检索链（依赖批5） |
| 批7 | 项目10 | 反驳生成引擎（依赖项目9） |
| 批8 | 项目11 | FastAPI 路由 + CLI 验收（依赖项目10） |

---

## 项目 1 · 环境初始化

### 目标
建立项目骨架目录、依赖管理、基础配置，使后续所有项目能正确导入。

### 方案

```
backend/
  ├── main.py               FastAPI 入口
  ├── config.py             配置管理（路径/Key/模型选择）
  ├── pyproject.toml        依赖声明（Poetry 管理）
  ├── api/                  路由层（空文件先行）
  ├── engine/               推理引擎（空文件先行）
  ├── ingestion/            入库流水线（空文件先行）
  ├── models/               AI 适配层（空文件先行）
  ├── storage/              数据访问层（空文件先行）
  └── logging/              结构化日志（空文件先行）
```

**config.py 核心配置项**：
- `KNOWLEDGE_BASE_PATH`：知识库根目录
- `SQLITE_PATH`：SQLite 文件路径
- `LANCE_PATH`：LanceDB 数据目录
- `BGE_M3_PATH`：BGE-M3 模型文件路径
- `LOG_PRIVACY_LEVEL`：`minimal` / `standard` / `debug`
- `DEFAULT_PROVIDER`：默认 LLM 服务商
- API Key 环境变量映射（从 `.env` 读取）

### 改动范围
- `backend/` 目录（新建）
- `backend/pyproject.toml`（新建）
- `backend/config.py`（新建）
- `backend/main.py`（新建，空路由）
- `.env.example`（新建，列出所有需要填写的 Key）
- `knowledge_base/` 目录结构（新建）

---

## 项目 2 · 存储层（SQLite + LanceDB）

### 目标
建立持久化存储的完整基础，包含 SQLite schema、FTS5 中文索引、LanceDB 向量库，以及级联删除和断点恢复机制。

### 方案

#### SQLite Schema（`storage/sqlite_store.py`）

```sql
-- 文档层
CREATE TABLE documents (
    doc_id      TEXT PRIMARY KEY,
    title       TEXT,
    author      TEXT,
    year        INTEGER,
    stance      TEXT,               -- 主立场
    source_type TEXT,               -- book/paper/news/url
    source_url  TEXT,
    import_date TEXT,
    quality_score REAL,
    provenance  TEXT                -- JSON：来源链、校验和
);

-- 章节层
CREATE TABLE chapters (
    chapter_id  TEXT PRIMARY KEY,
    doc_id      TEXT REFERENCES documents(doc_id),
    chapter_num INTEGER,
    title       TEXT,
    page_range  TEXT,
    token_count INTEGER,
    summary     TEXT                -- AI 生成的 150 字摘要
);

-- Chunk 层（全文检索 + 向量锚点）
CREATE TABLE chunks (
    chunk_id    TEXT PRIMARY KEY,
    chapter_id  TEXT REFERENCES chapters(chapter_id),
    doc_id      TEXT,
    text        TEXT,
    page_range  TEXT,
    embedding_model TEXT,           -- 版本绑定
    embedding_dim   INTEGER
);

-- FTS5 全文索引（jieba 分词）
CREATE VIRTUAL TABLE fts_index USING fts5(
    doc_id UNINDEXED,
    chunk_id UNINDEXED,
    content,
    tokenize = 'simple'             -- jieba tokenizer
);

-- 论证单元
CREATE TABLE arg_units (
    arg_id      TEXT PRIMARY KEY,
    chunk_id    TEXT,
    doc_id      TEXT,
    claim       TEXT,
    logic_pattern TEXT,
    counter_targets TEXT,           -- JSON array
    coordinates TEXT                -- JSON：22轴坐标
);

-- 入库断点恢复
CREATE TABLE ingestion_progress (
    doc_id      TEXT,
    chapter_id  TEXT,
    stage       TEXT,               -- summarized/analyzed/vectorized
    status      TEXT,               -- pending/done/failed
    PRIMARY KEY (doc_id, chapter_id, stage)
);
```

#### LanceDB 向量库（`storage/lance_store.py`）
- int8 量化，原生 S3 兼容
- 每条记录含 `embedding_model` 版本字段，查询时检查一致性
- 级联删除：删文档时同步清除 LanceDB 中对应向量

### 测试要求
- `pytest storage/test_sqlite.py`：建表、写入、FTS5查询、级联删除
- `pytest storage/test_lance.py`：写入向量、cosine 搜索、版本不一致报错

### 改动范围
- `backend/storage/sqlite_store.py`（新建）
- `backend/storage/lance_store.py`（新建）
- `backend/storage/` 目录下 `test_*.py`（新建）

---

## 项目 3 · BGE-M3 嵌入模型

### 目标
封装本地 BGE-M3 ONNX 嵌入，支持批量异步嵌入，输出 int8 量化向量，版本信息绑定到每条记录。

### 方案
- 模型路径：`config.BGE_M3_PATH`，首次运行自动下载（HuggingFace 或镜像）
- 懒加载：软件启动时不立即加载，首次嵌入请求时加载
- 批量处理：`embed_batch(texts: list[str]) -> list[np.ndarray]`
- 输出维度：1024，量化为 int8 写入 LanceDB

### 测试要求
- `pytest models/test_embedder.py`：加载验证 + 嵌入5条文本 + 维度正确

### 改动范围
- `backend/models/embedder.py`（新建）

---

## 项目 4 · 模型路由器

### 目标
按任务类型自动选择合适的 LLM 服务商，支持优先级链、自动降级（限速/内容过滤/超时）、自定义提供商。

### 方案

**五类任务默认优先级链**：

| 任务 | 链 |
|------|---|
| `summarize`（章节摘要） | Gemini 3 Flash → Cerebras → Groq |
| `ideology`（坐标分析） | Ollama → Groq DeepSeek-R1 → Mistral |
| `rebuttal`（反驳生成） | Groq Qwen3-32B → Gemini 3 Flash |
| `parse`（论点解析） | Groq → Ollama |
| `classify`（立场分类） | Ollama → Groq |

**降级触发规则**：429限速 → 切换同链下一个；内容过滤 → 直接切换本地；超时 → 切换更快的服务商。

**自定义服务商**：通过 `config.py` 的 `CUSTOM_PROVIDERS` 列表添加，兼容任意 OpenAI 格式 API。

### 改动范围
- `backend/models/llm_client.py`（新建，OpenAI 格式统一适配层）
- `backend/models/model_router.py`（新建，5类任务路由逻辑）

---

## 项目 5 · Skill 文件体系

### 目标
建立辩论立场 Skill 和文档入库 Skill 两套 Markdown 文件，供模型路由器和反驳引擎注入使用。

### 方案

**辩论立场 Skill（5 个预置）**：
- `knowledge_base/skills/stances/liberal.skill.md`（古典自由主义）
- `knowledge_base/skills/stances/marxist.skill.md`（马列毛主义）
- `knowledge_base/skills/stances/conservative.skill.md`（保守主义）
- `knowledge_base/skills/stances/social_democracy.skill.md`（社会民主主义）
- `knowledge_base/skills/stances/empirical.skill.md`（经验主义/数据派）

每个文件包含：世界观假设 / 反驳策略偏好 / 禁止用法 / 知识库检索偏好 / 各风格处理偏好 / Prompt 模板。

**文档入库 Skill（5 个预置）**：
- `knowledge_base/skills/ingestion/political_theory.skill.md`
- `knowledge_base/skills/ingestion/academic_paper.skill.md`
- `knowledge_base/skills/ingestion/news_article.skill.md`
- `knowledge_base/skills/ingestion/historical_document.skill.md`
- `knowledge_base/skills/ingestion/default.skill.md`

**加载器**（`storage/skill_loader.py`）：解析 Markdown frontmatter + 各段落，缓存到内存，支持热重载。

### 改动范围
- `knowledge_base/skills/stances/` 下 5 个 `.skill.md`（新建）
- `knowledge_base/skills/ingestion/` 下 5 个 `.skill.md`（新建）
- `backend/storage/skill_loader.py`（新建）

---

## 项目 6 · 文档解析管道

### 目标
支持 PDF/Word/Excel/TXT/MD/URL 六种格式的正确解析，保留文档结构（标题层级、表格单元），生成统一的 `ParsedDocument` 对象。

### 方案

**类型自动检测**（`ingestion/detector.py`）：根据扩展名 + 内容特征判断类型，选择对应 parser。

**各 Parser 职责**：
- `parser_pdf.py`：Docling 结构感知解析，提取标题层级、表格结构、章节树
- `parser_docx.py`：python-docx，保留 H1/H2/H3 层级作为切割边界
- `parser_excel.py`：openpyxl 读取表格 → LLM 转换为自然语言描述段落
- `parser_url.py`：trafilatura 提取正文，附带 URL/标题/日期元数据
- `parser_txt.py`：chardet 自动编码检测，直接读取

**ParsedDocument 数据结构**：
```python
@dataclass
class ParsedDocument:
    source_type: str
    title: str
    author: Optional[str]
    year: Optional[int]
    sections: list[Section]      # 章节树
    raw_metadata: dict           # 原始元数据
```

### 测试要求
- 每个 parser 至少一个正常路径测试 + 一个异常路径测试
- `pytest ingestion/test_parsers.py`

### 改动范围
- `backend/ingestion/detector.py`（新建）
- `backend/ingestion/parser_pdf.py`（新建）
- `backend/ingestion/parser_docx.py`（新建）
- `backend/ingestion/parser_excel.py`（新建）
- `backend/ingestion/parser_url.py`（新建）
- `backend/ingestion/parser_txt.py`（新建）

---

## 项目 7 · 文本分块器

### 目标
按文档结构（目录/标题边界）切割，保证每块语义完整，控制每块 ≤ 8K tokens，生成 `Chunk` 列表。

### 方案

**优先级策略**（`ingestion/chunker.py`）：
1. PDF 书签 / 文档目录 → 按章节切割（最精确）
2. H1/H2 标题边界 → 按标题层级切割
3. 语义边界检测（相邻段落嵌入相似度突变）→ 备用
4. 固定边界（8K 硬切）→ 最后手段

**超长章节处理**：单章超过 8K tokens 时，按 H2 子标题进一步细分。

**短文章**（< 2K tokens）：不切割，整体作为一块。

**过滤规则**：跳过参考文献、索引、目录页本身、版权页（通过标题关键词匹配）。

### 测试要求
- `pytest ingestion/test_chunker.py`：含书签的 PDF、无标题纯文本、超长章节三个场景

### 改动范围
- `backend/ingestion/chunker.py`（新建）

---

## 项目 8 · 入库流水线统筹

### 目标
将项目 2-7 的组件串联为完整的 10 步入库流程，实现断点恢复（跳过已完成步骤）、token 消耗预估、立场自动分类与人工确认接口。

### 方案

**入库流程**（`ingestion/indexer.py`）：

```
Stage 0  Docling 结构提取         本地，免费
Stage 1  TOC/标题切割             本地，免费
Stage 2  BGE-M3 向量化            本地，免费
Stage 3  章节摘要                 免费 API（Gemini/Cerebras/Groq）
Stage 4  全书意识形态分析          免费 API（喂摘要，极小消耗）
Stage 5  坐标提取（22轴）          Ollama 优先（敏感内容）
Stage 6  立场自动分类              向量 + LLM
Stage 7  写入 SQLite + LanceDB    本地
Stage 8  生成 meta.json           本地
Stage 9  归档 source.*            本地
Stage 10 更新 INDEX.md            本地
```

**断点恢复**：每个 Stage 完成后写入 `ingestion_progress` 表；重新入库时 `SELECT status FROM ingestion_progress WHERE doc_id=? AND stage=?`，跳过 `done` 的阶段。

**立场确认 API**（`api/import_doc.py`）：
- `POST /api/import`：触发 Stage 0-6，返回推断立场和置信度
- `POST /api/import/confirm`：用户确认立场后，触发 Stage 7-10

**全文总结策略**：
- 默认 Map-Reduce（并行，token 最省）
- 逻辑递进著作 → Refine Chain（串行，保留跨章逻辑）
- 重要核心文献 → Gemini 全文投喂（最准确，消耗一次配额）

### 测试要求
- `pytest ingestion/test_pipeline.py`：单章级快速测试 + 断点恢复测试（模拟 Stage 3 失败后重跑）

### 改动范围
- `backend/ingestion/indexer.py`（新建，流水线总调度）
- `backend/ingestion/summarizer.py`（新建，三种总结策略）
- `backend/ingestion/classifier.py`（新建，立场分类）
- `backend/api/import_doc.py`（新建）

---

## 项目 9 · 核心检索链

### 目标
实现带立场的混合检索：ArgumentParser 结构化解析论点 → StanceRouter 确定检索范围 → LanceDB+FTS5 粗检索 → 立场精排 → Top-5 候选块。

### 方案

**ArgumentParser**（`engine/argument_parser.py`）：

```python
# 输出结构
ParsedArgument = {
    "core_claim": str,
    "conditions": list[str],
    "negations": list[str],
    "implicit_target": str,     # 用于检索
    "attack_surface": list[str] # 用于生成
}
```

LLM 提取，使用 `parse` 任务类型走模型路由器。

**StanceRouter**（`engine/stance_router.py`）：
- 从 Skill 文件读取"检索偏好"（优先/交叉/排除目录）
- 按 22轴坐标距离计算，近的立场权重×1.5，远的×0.3

**Hybrid Retrieval**（`engine/retriever.py`）：
- 向量：`implicit_target` 嵌入后查 LanceDB cosine → Top-20
- 全文：`core_claim` + `keywords` 查 FTS5 BM25 → Top-20
- RRF 融合：`score = 1/(k+rank_vector) + 1/(k+rank_fts)`，k=60
- 合并去重 → Top-30

**Reranker**（`engine/reranker.py`）：
- 按 Skill 的立场偏好加权
- 排除 `conditions/negations` 相关的无关块
- 最终返回 Top-5

### 测试要求
- `pytest engine/test_retriever.py`：立场污染测试（liberal 检索不返回 marxist 文档）
- `pytest engine/test_parser.py`：含否定词/条件词的论点不被稻草人化

### 改动范围
- `backend/engine/argument_parser.py`（新建）
- `backend/engine/stance_router.py`（新建）
- `backend/engine/retriever.py`（新建）
- `backend/engine/reranker.py`（新建）

---

## 项目 10 · 反驳生成引擎

### 目标
将 Top-5 检索结果 + Skill Prompt + 格式/风格参数组装为 LLM 请求，生成带真实引用的反驳，支持流式输出，防止引用幻觉。

### 方案

**防幻觉机制**（`engine/rebuttal_engine.py`）：
1. 从 `meta.json` 提取引用元数据（作者/年份/页码）注入 prompt
2. 要求 LLM 只使用已注入的引用 ID，不得编造
3. 输出后验证：每个引用 ID 必须在注入的 context 中存在，否则触发重试

**Prompt 构建逻辑**：
```
System: {Skill 文件中的 Prompt 模板} + {风格说明}
User: 对方论点：{原始论点}
      论点解析：{ParsedArgument}
      可用资料（{len(chunks)}条）：
        [{引用ID}] {作者}, {年份}: {chunk 文本}
        ...
      要求：用{格式}格式，以{风格}风格生成反驳，引用只能使用以上资料。
```

**输出格式**（3种 × 8种风格 = 任意组合）：
- `quick`：3句以内，1-2个引用
- `argument`：结构化段落，完整论证链
- `report`：学术格式，完整参考文献列表

**流式输出**：`yield chunk` 方式通过 FastAPI SSE 推送，前端 StreamingText 组件接收。

### 测试要求
- `pytest engine/test_rebuttal.py`：引用幻觉测试（输出引用必须在注入 context 中）
- 测试至少 3 种格式 × 2 种风格的组合

### 改动范围
- `backend/engine/rebuttal_engine.py`（新建）

---

## 项目 11 · FastAPI 路由 + CLI 验收

### 目标
将所有引擎组装为 HTTP API，提供 5 个核心接口，并实现命令行测试工具，验证端到端的完整链路质量。

### 方案

**FastAPI 路由**（`api/*.py`）：

```
POST /api/rebuttal     论点 → 反驳（SSE 流式）
POST /api/import       文件路径/URL → 导入预览
POST /api/import/confirm  确认立场 → 完成入库
GET  /api/knowledge/docs  知识库文档列表
GET  /api/stances      已配置的立场 + 统计
GET  /api/health       依赖健康检查
```

**CLI 测试工具**（`cli.py`）：

```bash
# 导入一篇文档
python cli.py import ./docs/hayek.pdf --stance liberal

# 生成反驳
python cli.py rebut "政府管制能提高经济效率" --stance liberal --style critique --format argument

# 搜索知识库
python cli.py search "市场失灵" --stance liberal

# 运行质量评估（检索命中率/引用正确率）
python cli.py eval --stance liberal --test-set ./tests/test_arguments.json
```

**验收标准**（End-to-End）：
1. 导入一篇 PDF → 入库成功，meta.json 正确生成
2. 输入任意中文论点 → 3秒内返回带至少1条真实引用的反驳（速辩模式）
3. 立场过滤验证：liberal 立场检索不返回 marxist 目录的文档
4. 防幻觉验证：输出中所有引用均在注入 context 中存在

### 改动范围
- `backend/api/rebuttal.py`（新建）
- `backend/api/knowledge.py`（新建）
- `backend/api/stances.py`（新建）
- `backend/api/diagnostics.py`（新建，/health 接口）
- `backend/main.py`（更新，注册所有路由）
- `backend/cli.py`（新建，CLI 测试工具）

---

## 实施顺序

| 顺序 | 项目 | 前置依赖 | 说明 |
|---|---|---|---|
| 1 | 项目 1（环境） | — | 必须第一个做，所有模块依赖 |
| 2 | 项目 2（存储层） | 项目 1 | 数据持久化基础 |
| 3 | 项目 3（BGE-M3） | 项目 1 | 嵌入模型基础 |
| 4 | 项目 4（模型路由器） | 项目 1 | AI 调用基础，并行可做 |
| 5 | 项目 5（Skill 文件） | 项目 1 | 纯 Markdown，并行可做 |
| 6 | 项目 6（文档解析） | 项目 1 | 独立模块，并行可做 |
| 7 | 项目 7（分块器） | 项目 6 | 依赖解析产物 |
| 8 | 项目 8（入库流水线） | 项目 2~7 全部 | 整合所有底层 |
| 9 | 项目 9（检索链） | 项目 2、3、5、8 | 需要已入库数据 |
| 10 | 项目 10（反驳引擎） | 项目 4、5、9 | 核心业务逻辑 |
| 11 | 项目 11（路由+CLI） | 项目 8、10 | 集成验收 |

每批边界三件事：`mypy` 类型检查 → `pytest` 单元测试 → `git commit` 台账追加。

---

## 验收清单（E2E）

1. `python cli.py import ./tests/hayek.pdf --stance liberal` → 入库成功，生成 `doc_*.meta.json` 含正确坐标
2. `python cli.py rebut "计划经济优于市场" --stance liberal --style rebuttal --format quick` → 3 秒内输出含引用的反驳
3. 立场隔离：`search "效率" --stance marxist` 不返回 liberal 目录文档
4. 防幻觉：引用输出中不出现未在 context 中存在的作者名或书名
5. 断点恢复：入库中途中断后重启，自动跳过已完成阶段
6. 模型降级：临时屏蔽 Groq API Key，系统自动切换 Gemini 完成同一请求
7. `GET /api/health` → 返回各依赖状态（BGE-M3加载/SQLite/LanceDB）
8. 全量 `pytest` → 0 failed

---

## 版本号同步
- `backend/pyproject.toml`：version = `"0.1.0"`
- `ARCH-debate-engine.md` 版本路线图中 V1.0 对应本版本，打包后更新为已完成状态
