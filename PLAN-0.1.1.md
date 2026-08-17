# PLAN-0.1.1 · 引擎补全（查重、谬误、风格、批量导入）

> 版本定位：0.1.1 仍是命令行版本（无桌面 UI），目标是补齐 0.1.0 与架构文档的差距项，
> 并落地用户评审提出的建议。四阶段流程已走完（收集→列项→自评→换位评审 + 联网查缺），
> 本文档为已确认清单的实施计划。
>
> 源码路径：`backend/`（已存在，0.1.0 完成态）
> 参考架构：`ARCH-debate-engine.md`
> 上版计划：`PLAN-0.1.0.md`

---

## 已确认决策记录

| # | 决策 | 结论 |
|---|------|------|
| 1 | 庸俗辩证法风格定位 | **B：反面演示**——输出明确标注「这是错误示范」，教学对照用 |
| 2 | 鲁迅式杂文风格 | **不加**（文风不是方法论） |
| 3 | 新增风格最终名单 | 唯物辩证法、庸俗辩证法（反面演示）、归谬法、内在批判（以子之矛）、面向观众，共 5 个 |
| 4 | 向量层瘦身（去 lancedb） | **维持现状**，不做（105.7MB 安装包可接受） |
| 5 | 服务商 Key 配置 | 交互模式加 `config` 命令，软件内填 Key 自动写 `.env`（图形设置页留给 V1.1） |

## 明确缓做（不进 0.1.1）

- 云备份（LanceDB S3 + Litestream）→ V1.2
- 搜索结果 UI、服务商配置界面、右键菜单本体、配额状态栏 → V1.1 桌面版
- 忠实度 / 答案相关性两个收费评分维度 → 架构文档记录方向，实现为可选开关默认关
- INDEX.md 大库全量重写性能 → V2 已知债（当前量级毫秒级）
- V1.1 前置约束（记入架构文档）：辩论历史功能的引用必须存快照而非活引用

---

## 版本概述

本版本共 11 个项目，按依赖与风险升序分 5 批：

| 批次 | 项目 | 说明 |
|---|---|---|
| 批1 | 项目1 | 文档身份体系（改主键，其余多数依赖，最先做） |
| 批2 | 项目2、3 | 导入查重/版本更新 + 批量导入/断点恢复（依赖批1） |
| 批3 | 项目4、5 | 入库深度分析 + 标准化.md/全文投喂（互相独立，可并行） |
| 批4 | 项目6、7、8 | 谬误系统 + 输出参数 + config 命令（反驳侧，独立于入库侧） |
| 批5 | 项目9、10、11 | 检索升级 + 手动改立场 + 22轴坐标（收尾） |

---

## 项目 1 · 文档身份体系（内容哈希 doc_id）

### 目标
修复 doc_id = 路径哈希的缺陷（`ingestion/indexer.py` `_doc_id_for`），改为**内容哈希**，
为查重、版本更新、批量导入提供地基。

### 方案
1. `_doc_id_for(source)` 改为 sha256(文件字节)[:12]；URL 导入用抓取后正文文本哈希
2. `documents` 表新增两列：`content_hash TEXT`（完整 sha256）、`source_path TEXT`（原始来源）
3. 语义关系：同 content_hash → 完全重复；同 source_path 不同 hash → 新版本（项目2 消费）
4. 新增 `cli.py migrate` 命令：旧库迁移
   - 建"旧 doc_id → 新 doc_id"映射表，逐表 UPDATE（documents/chapters/chunks/FTS/ingestion_progress）
   - 向量库记录的 doc_id/chunk_id 字段同步改写
   - `.cache/{doc_id}.summaries.json` 摘要缓存按映射改名（**防止重烧 API 配额**）
   - meta.json 内 doc_id 字段更新
   - 迁移前自动备份 knowledge.db
5. 版本号统一：`config.py` 新增 `VERSION = "0.1.1"` 常量，`main.py`/`api/diagnostics.py`/`cli.py`
   三处字面量改为引用

### 改动范围
- `ingestion/indexer.py`（_doc_id_for、confirm 写入新列）
- `storage/sqlite_store.py`（schema 迁移 + 新列）
- `storage/lance_store.py`（按 doc_id 改写记录的辅助方法）
- `cli.py`（migrate 子命令）
- `config.py` / `main.py` / `api/diagnostics.py`（VERSION 常量）

### 风险
最高风险项（七处关联改动）。缓解：迁移命令幂等可重跑；测试用 0.1.0 格式的临时库验证迁移。

---

## 项目 2 · 导入查重与版本更新

### 目标
同一文档不再重复入库；文件内容更新时可控地替换旧版。

### 方案
1. preview 阶段先算 content_hash 查 documents 表：
   - **完全重复**（hash 相同）：默认静默跳过，只记日志（批量导入不打断）
   - **新版本**（source_path 相同、hash 不同）：提示"检测到新版本"
2. **语义近重复**：用已有的全书摘要向量与库内文档比对（余弦 > 0.92 提示"疑似同书不同版本"，
   如 PDF 版与 TXT 版），不引入 SimHash 等新依赖
3. CLI 参数 `--on-duplicate skip|replace|keep-both`（默认 skip）；replace = 级联删旧 + 入新
4. 更新机制即"replace 路径"：删除走现有 delete_document 五源级联

### 改动范围
- `ingestion/indexer.py`（preview 查重逻辑 + replace 分支）
- `cli.py`（import 加 --on-duplicate）
- `api/import_doc.py`（preview 响应加 duplicate 字段，confirm 支持 on_duplicate）

---

## 项目 3 · 批量导入 + 断点恢复扩展

### 目标
多文件/文件夹一次导入；管线中断后坐标、分类阶段也能续传（0.1.0 只覆盖摘要阶段）。

### 方案
1. `cli.py import` 支持多个 source 参数与目录（递归收集支持的扩展名，不支持的跳过并计入报告）
2. **逐文件异常隔离**：单文件失败不中断队列；结束输出三栏汇总（成功/跳过重复/失败+原因）
3. 批量前用现有 token_estimate 汇总预估 API 消耗并提示确认（`--yes` 跳过）
4. 断点恢复扩展：ingestion_progress 增加 `coordinates`、`classified` 阶段标记，
   坐标与分类结果随摘要一起写入 `.cache/{doc_id}.summaries.json`，续传时跳过已完成阶段
5. `api/import_doc.py` 加批量端点（逐个复用单文件流程，返回任务列表）

### 改动范围
- `cli.py`（import 多源 + 报告）
- `ingestion/indexer.py`（阶段标记 + 缓存扩展）
- `api/import_doc.py`（批量端点）

---

## 项目 4 · 入库深度分析（Skill 注入 + 论证单元 + Excel 转述）

### 目标
补齐三条架构差距：入库 Skill 从"只加载"变"真注入"；arg_units 表开始有数据；
Excel 从结构拼接升级为模型转述。

### 方案
1. **Skill 注入**：summarize / classify 的提示词组装处，按文档类型选中对应入库 Skill
   （`skill_loader` 已能加载），把其指导内容注入 system 段
2. **论证单元合并提取**：章节摘要调用时同一提示词要求输出
   `{summary, arg_units: [{claim, evidence, logic_pattern}]}`；解析失败自动降级为两次独立调用
   （多一次配额但不丢数据）；结果写 arg_units 表
3. **Excel 转述**：source_type=excel 时用表格专用提示词（把结构化行列转述为自然语言段落）
4. 新增第 6 个入库 Skill：`knowledge_base/skills/ingestion/data_table.skill.md`
   （指导表格类文档的转述与分块）

### 改动范围
- `ingestion/summarizer.py`（提示词注入 + 合并输出解析 + 降级）
- `ingestion/classifier.py`（提示词注入）
- `ingestion/indexer.py`（arg_units 写入）
- `storage/sqlite_store.py`（arg_units 写入方法，如缺）
- `knowledge_base/skills/ingestion/data_table.skill.md`（新建）

---

## 项目 5 · 标准化 .md 生成 + 全文投喂策略

### 目标
入库产物补上人可读的标准化 Markdown；长上下文模型可用时提供第三种摘要策略。

### 方案
1. Stage 8 生成 `STANCES_PATH/{stance}/{doc_id}.md`：frontmatter（标题/作者/坐标/立场）+
   全书摘要 + 章节摘要 + 论证单元列表；delete_document 级联删除同步加此文件（第六处）
2. 全文投喂策略：`summarizer.py` 增加 `full_context` 策略——文档总 token 低于模型上下文
   窗口（按服务商能力表判断，Gemini 类大窗口优先）时整书单次投喂；不满足自动回落 Map-Reduce
3. 策略选择参数化：`--summary-strategy auto|map_reduce|refine|full_context`（默认 auto）

### 改动范围
- `ingestion/indexer.py`（Stage 8 + 删除级联第六处）
- `ingestion/summarizer.py`（full_context 策略 + auto 判断）
- `cli.py` / `api/import_doc.py`（策略参数）

---

## 项目 6 · 谬误系统

### 目标
反驳时识别并点名对方论点中的逻辑谬误；己方输出自检不犯谬误。

### 方案
1. 新建 `knowledge_base/skills/fallacies.md`：24 种常见谬误知识库
   （稻草人、假因果、诉诸情感、谬误谬误、滑坡、人身攻击、你也一样、个人怀疑、特殊恳求、
   复杂问句、举证责任转移、歧义、赌徒谬误、从众、诉诸权威、合成/分割、没有真正的苏格兰人、
   起源谬误、非黑即白、乞题、诉诸自然、轶事证据、德州神枪手、中间立场）。
   每条含：名称 / 定义 / 识别特征。Markdown 格式，用户可增删
2. `engine/argument_parser.py`：解析提示词注入谬误特征表，输出增加
   `detected_fallacies: [{name, quote, reason}]`；**一律带"疑似"语义**，不下断言
3. `engine/rebuttal_engine.py`：检测结果注入反驳提示词（"对方论证疑似存在X谬误，可点名"）；
   同时加一条自检约束（"你的反驳不得使用这些谬误"）——零额外成本
4. 总开关：`--fallacy on|off`（默认 on）；离线模式（OfflineProvider）自动跳过标注
5. 准确率风险对策（联网证据：政治辩论语境谬误分类是公认难题）：只做"疑似提示"，
   不做自动判定结论

### 改动范围
- `knowledge_base/skills/fallacies.md`（新建）
- `models/skill_loader.py`（加载 fallacies.md）
- `engine/argument_parser.py`（检测输出）
- `engine/rebuttal_engine.py`（注入 + 自检 + 开关）
- `cli.py` / `api/rebuttal.py`（参数透传）

---

## 项目 7 · 输出参数（风格配置化 + 字数 + 引用导出）

### 目标
风格从硬编码字典迁到配置文件并扩充 5 个新风格；回复字数可控；引用可按学术格式导出。

### 方案
1. **风格配置化**：新建 `knowledge_base/skills/styles.md`（与 Skill 同格式，每风格一节：
   名称 / 描述 / 提示词要点 / 是否反面演示标记）。`rebuttal_engine.py` 的 STYLES 字典改为
   启动时从该文件加载（文件缺失时回落内置默认，保证健壮）。用户可自行加风格
2. **新增 5 风格**：唯物辩证法（矛盾分析、历史具体、发展眼光）；庸俗辩证法
   （**反面演示**：和稀泥式折中、各打五十大板，输出头部固定标注「⚠ 反面演示——这是错误示范」）；
   归谬法（顺着对方逻辑推到荒谬结论）；内在批判（只用对方阵营的前提和经典打对方）；
   面向观众（说服目标是围观者而非对手）
3. **字数参数**：`--length N`（汉字数，上限 2000，超出直接报错提示）。规则：
   显式字数优先于格式默认值（速辩默认 3 句会被显式 length 覆盖）；提示词按字数档位调整
   引用密度要求（短→只引最强 1 条，长→多引+展开论据）；超出目标 ±30% 仅提示不强制重生成
4. **引用导出**：`build_citations` 产出的元数据已够用，增加格式化器输出
   GB/T 7714 与 APA 两种格式；CLI `rebut --cite-format gbt7714|apa|plain`（默认 plain），
   API 响应增加 `citations_formatted` 字段
5. **config 命令**（决策 5）：交互模式与子命令均可用——列出服务商配置状态，选序号粘贴 Key，
   校验非空后写入 exe 同目录 `.env`（已存在则更新对应行），随后热重载 config 的
   PROVIDER_KEYS 并重建路由器，立即生效无需重启

### 改动范围
- `knowledge_base/skills/styles.md`（新建）
- `engine/rebuttal_engine.py`（STYLES 加载 + 字数 + 引用格式化）
- `models/skill_loader.py`（styles.md 加载）
- `cli.py`（--length / --cite-format / config 命令）
- `api/rebuttal.py`（参数透传）
- `config.py`（reload 辅助函数）

---

## 项目 8 · 检索升级（搜索模式 + 免费质量评分）

### 目标
搜索方式用户可控；检索质量有客观数字可看。

### 方案
1. 搜索模式参数 `--mode keyword|semantic|hybrid|smart`（默认 hybrid）：
   keyword = 仅 FTS5；semantic = 仅向量；hybrid = 现有 RRF 融合；
   smart = 先走 parse 任务链做一次查询改写（口语→检索式），再 hybrid
2. 质量评分只做免费两维（RAGAS 思路）：上下文相关性 = Top-5 向量相似度均值；
   块利用率 = 生成文本与检索块的字符重叠率。写入检索日志（现有 Trace-Span 体系），
   `search`/`rebut` 输出尾部附一行评分
3. 收费两维（忠实度/答案相关性）实现为 `QUALITY_LLM_EVAL` 配置开关，默认 false，本版不实现调用

### 改动范围
- `engine/retriever.py`（模式分支）
- `engine/reranker.py`（评分计算 + 日志）
- `cli.py` / `api/`（mode 参数）

---

## 项目 9 · 手动改立场（后端 + CLI）

### 目标
AI 分错立场后用户可改，六处数据同步；为 V1.1 右键菜单提供现成接口。

### 方案
1. `Indexer.reassign_stance(doc_id, new_stance)`，六处同步：
   ① documents.stance 字段；② meta.json 移动到新立场目录；③ 标准化 .md 移动（项目5 产物）；
   ④ INDEX.md 重新生成；⑤ 检索权重自然生效（StanceRouter 每次现算，无缓存，已核实）；
   ⑥ 统计缓存/日志记录一条 reassign 事件
2. CLI：`debate-engine reassign <doc_id> <new_stance>`
3. API：`PATCH /api/knowledge/docs/{doc_id}/stance`

### 改动范围
- `ingestion/indexer.py`（reassign_stance）
- `cli.py`（reassign 子命令）
- `api/knowledge.py`（PATCH 端点）

---

## 项目 10 · 坐标体系（9 → 22 轴 + 国家预设中心点）

### 目标
补齐架构承诺的 22 轴意识形态坐标；预设中心点可切换为不同国家的主流意识形态。

### 方案
1. `ingestion/classifier.py` AXES 扩展到 22 轴（按架构文档 §16.1 定义补 13 轴：
   distribution 分配、welfare 福利、democracy_type 民主形态、organization 组织方式、
   constitutionalism 宪政法治、identity 身份政治、gender 性别、secularism 政教关系、
   ontology 整体/个体、ecology 生态、ai_automation 技术加速、globalization 全球化、
   historical_view 历史观）。两级要求：原 9 轴必填，新 13 轴尽力而为
2. 逐轴校验：模型输出缺轴自动补 0，并在 meta.json 标 `low_confidence_axes` 列表
3. 国家预设：架构 §16.2 已有 5 个预置中心点（日子人/社民默认、社会民主主义、
   古典自由主义、马列毛主义、中国主流），本版落地为 `knowledge_base/skills/centers.md`
   并扩充国家系预设（美国主流、欧盟主流等，22 轴取值 + 一句说明），`--center <name>`
   参数让立场分类与检索加权以该点为参照；默认沿用现状（无中心偏移）
4. 22 轴提示词变长 → 坐标提取仍走本地优先链（敏感任务），提示词分两段避免漏轴

### 改动范围
- `ingestion/classifier.py`（AXES + 校验 + 中心点参照）
- `knowledge_base/skills/centers.md`（新建）
- `models/skill_loader.py`（centers.md 加载）
- `cli.py` / `api/`（--center 参数）

---

## 项目 11 · 文档与打包收尾

### 目标
版本收口：文档同步、测试补齐、重新打包。

### 方案
1. `ARCH-debate-engine.md`：写入本版全部新特性小节 + 缓做清单标注 + V1.1 引用快照前置约束
2. 测试补齐（预计 +25~30 条，全部离线可跑）：迁移命令、查重三分支、批量报告、
   合并提取降级、谬误开关、styles.md 加载回落、字数上限、引用格式、搜索模式、reassign 六处、
   22 轴缺轴校验
3. `installer.nsi` 版本号 0.1.1，重打安装包，实测装/卸/交互模式
4. 行数扫描（对照 `Software Architecture.md` §2）+ 越线处置上报
5. Git 提交推送 + 改动台账更新

---

## 验收标准（关键项）

1. 同一文件两次 import：第二次静默跳过；改动文件内容后 import：提示新版本，replace 后旧版消失
2. 文件夹导入含 1 个坏文件：其余成功，报告三栏正确
3. `rebut` 对含稻草人谬误的论点：输出点名"疑似稻草人谬误"；`--fallacy off` 后不出现
4. `--style 庸俗辩证法` 输出头部带反面演示标注
5. `--length 300` 与 `--length 1500` 输出长度和引用密度可见差异；`--length 3000` 报错
6. `config` 命令填 Key 后不重启，health 里对应 provider 变 true
7. `reassign` 后：搜索立场隔离立即生效，meta.json 与 .md 已在新目录
8. migrate 后旧库文档可正常检索且摘要缓存未丢失（不重烧配额）
9. pytest 全绿（0.1.0 的 43 条 + 新增全部）

---

## 改动台账

> 实施时逐批追加：批次 / 文件 / 改动摘要 / 编译与测试结果

（待开工）
