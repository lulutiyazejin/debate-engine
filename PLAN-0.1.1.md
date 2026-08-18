# PLAN-0.1.1 · 完整桌面软件（引擎补全 + 桌面 UI + 高级分析）

> 版本定位：0.1.1 交付一个**正常能用能交互的窗口软件**（Tauri + React），
> 不再以命令行为用户界面——cmd 窗口在交付形态中彻底消失，CLI 降级为开发调试工具。
> 范围 = 引擎补全（查重/谬误/22轴等）+ 全部桌面界面 + 知识库打包器 + 论证对齐引擎 +
> 图谱/冲突/对比/综合报告/溯源。体量约等于原路线图四个版本，按 11 个批次推进，
> 每批独立可验证。
>
> 源码路径：`backend/`（引擎，0.1.0 完成态）+ `desktop/`（Tauri 前端，本版新建）
> 参考架构：`ARCH-debate-engine.md`
> 上版计划：`PLAN-0.1.0.md`

---

## 已确认决策记录

| # | 决策 | 结论 |
|---|------|------|
| 1 | 庸俗辩证法风格定位 | **B：反面演示**——输出明确标注「这是错误示范」，教学对照用 |
| 2 | 鲁迅式杂文风格 | **不加**（文风不是方法论） |
| 3 | 新增风格最终名单 | 唯物辩证法、庸俗辩证法（反面演示）、归谬法、内在批判（以子之矛）、面向观众，共 5 个 |
| 4 | 向量层瘦身（去 lancedb） | **维持现状**，不做 |
| 5 | 服务商 Key 配置 | 引擎提供 config 能力；用户界面为图形化设置页（项目13） |
| 6 | 知识库导出/分享 | 与云备份合并为"知识库打包器"，一次设计两处复用 |
| 7 | 跨页面论点对比 | 与立场冲突检测共用论证对齐引擎 |
| 8 | 软件形态 | **桌面 UI 并入 0.1.1（选A）**：交付形态 = Tauri 窗口软件；启动无任何 cmd 窗口，引擎作为后台进程隐藏运行 |
| 9 | 数据库 | **B 方案：服务器级设计规范 + 存储抽象层**，SQLite 为默认实现；未来数据规模/协作需求到位时插入 PostgreSQL 实现，业务代码零改动 |
| 10 | 版本分期 | **取消 V1.1/V1.2/V2.0/V2.5 分期**，原路线图全部项目并入 0.1.1 一个版本交付 |

### 已砍掉（用户决定不做）
反驳强度评分、多轮辩论推演、苏格拉底模式、辩论训练模式、实时辩论辅助（语音）

### 已记录债（本版不做）
- 忠实度/答案相关性收费评分：留开关默认关
- INDEX.md 大库全量重写性能：库规模上来后改增量更新
- 法庭质证、外交辞令风格：styles.md 配置化后用户自行可加
- 登录站点 URL 爬取（CDP 方案）：本版只做公开可读页面
- 真"跨网页"对比形态：等准浏览器远期定位，本版为库内文档/粘贴文本对比

---

## 版本概述

共 18 个项目，按依赖与风险升序分 11 批：

| 批次 | 项目 | 说明 |
|---|---|---|
| 批1 | 项目1 | 数据地基：内容哈希 + 服务器级 schema + 存储抽象层（其余全部依赖） |
| 批2 | 项目2、3 | 导入查重/版本更新 + 批量导入/断点恢复 |
| 批3 | 项目4、5 | 入库深度分析 + 标准化.md/全文投喂 |
| 批4 | 项目6、7、8 | 谬误系统 + 输出参数 + 检索升级（反驳侧） |
| 批5 | 项目9、10 | 手动改立场 + 22轴坐标（引擎侧收口） |
| 批6 | 项目11 | Tauri 桌面框架（窗口、三栏、引擎隐藏启动、流式对接） |
| 批7 | 项目12、13 | 核心界面四件套 + 设置与运维界面 |
| 批8 | 项目14 | 知识库打包器（云备份 + 导出/分享） |
| 批9 | 项目15 | 论证对齐引擎 + 内部分歧地图 + 跨页对比 |
| 批10 | 项目16、17 | 论点图谱 + URL 自动入库 + 综合报告 + 溯源 |
| 批11 | 项目18 | 文档、测试与打包收尾 |

引擎批次（1-5）先行的原因：全部界面都消费这些接口，顺序反了必然返工。

---

## 项目 1 · 数据地基（内容哈希 + 服务器级 schema + 存储抽象层）

### 目标
修复 doc_id = 路径哈希缺陷（`ingestion/indexer.py` `_doc_id_for`）；schema 升级到
服务器级设计规范（决策 9）；存储层接口正式化，为未来切换 PostgreSQL 留活口。

### 方案
1. `_doc_id_for(source)` 改为 sha256(文件字节)[:12]；URL 导入用抓取后正文文本哈希
2. `documents` 表新增：`content_hash TEXT`（完整 sha256）、`source_path TEXT`；
   同批给 `arg_units` 表预留后续字段（本版部分填充）：`chunk_id`（所属块关联）、
   `thinker`/`school`（溯源元数据，项目4 填）、`relation`/`target_unit_id`（图谱边，项目16 填）
3. **服务器级 schema 规范**（本次迁移一并落地）：
   - 全表启用严格外键约束（PRAGMA foreign_keys + ON DELETE 级联声明化）
   - 高频查询建覆盖索引（stance+doc_id、content_hash、source_path、chunk→doc 关联）
   - 全表加 `created_at`/`updated_at` 时间戳、`deleted_at` 软删除标记（级联删除改软删+
     定期清理，误删可恢复）
   - WAL 并发模式 + 批量写统一事务包裹
   - 容量假设按**亿级分块**设计索引与查询（不做全表扫描式查询）
4. **存储抽象层**：`storage/base.py` 定义 `MetadataStore` / `VectorStore` 抽象接口
   （现有 sqlite_store/lance_store 改为实现类），业务代码只依赖接口；
   工厂函数按配置选实现——未来写 PostgresStore 插上即用，业务零改动
5. 语义关系：同 content_hash → 完全重复；同 source_path 不同 hash → 新版本（项目2 消费）
6. `cli.py migrate` 命令：旧库迁移
   - 旧→新 doc_id 映射表，逐表 UPDATE（documents/chapters/chunks/FTS/ingestion_progress）
   - 向量库 doc_id/chunk_id 同步改写；`.cache/{doc_id}.summaries.json` 按映射改名
     （**防止重烧 API 配额**）；meta.json 更新；迁移前自动备份 knowledge.db
7. 版本号统一：`config.py` 新增 `VERSION = "0.1.1"`，`main.py`/`api/diagnostics.py`/`cli.py`
   三处字面量改引用

### 改动范围
- `storage/base.py`（新建，抽象接口）
- `storage/sqlite_store.py`（schema 迁移 + 规范落地 + 实现类化）
- `storage/lance_store.py`（实现类化 + doc_id 改写辅助）
- `ingestion/indexer.py`（_doc_id_for、confirm 写新列）
- `cli.py`（migrate 子命令）
- `config.py` / `main.py` / `api/diagnostics.py`（VERSION 常量）

### 风险
全计划最高风险项（改主键 + 改 schema + 抽接口三合一）。缓解：迁移命令幂等可重跑；
用 0.1.0 格式临时库做迁移测试；抽象接口先抽后改，每步跑全量测试。

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
3. 参数 `--on-duplicate skip|replace|keep-both`（默认 skip）；replace = 级联删旧 + 入新
4. 更新机制即"replace 路径"：删除走现有 delete_document 级联（软删除后的新语义）

### 改动范围
- `ingestion/indexer.py`（preview 查重逻辑 + replace 分支）
- `cli.py`（import 加 --on-duplicate）
- `api/import_doc.py`（preview 响应加 duplicate 字段，confirm 支持 on_duplicate）

---

## 项目 3 · 批量导入 + 断点恢复扩展

### 目标
多文件/文件夹一次导入；管线中断后坐标、分类阶段也能续传（0.1.0 只覆盖摘要阶段）。

### 方案
1. import 支持多 source 与目录（递归收集支持的扩展名，不支持的跳过并计入报告）
2. **逐文件异常隔离**：单文件失败不中断队列；结束输出三栏汇总（成功/跳过重复/失败+原因）
3. 批量前用现有 token_estimate 汇总预估 API 消耗并提示确认（`--yes` 跳过）
4. 断点恢复扩展：ingestion_progress 增加 `coordinates`、`classified` 阶段标记，
   坐标与分类结果随摘要一起写入 `.cache/{doc_id}.summaries.json`，续传时跳过已完成阶段
5. `api/import_doc.py` 加批量端点 + **进度查询端点**（返回队列各文件阶段状态，
   供项目12 导入 UI 显示进度条）

### 改动范围
- `cli.py`（import 多源 + 报告）
- `ingestion/indexer.py`（阶段标记 + 缓存扩展）
- `api/import_doc.py`（批量端点 + 进度端点）

---

## 项目 4 · 入库深度分析（Skill 注入 + 论证单元 + Excel 转述）

### 目标
入库 Skill 从"只加载"变"真注入"；arg_units 表开始有数据；Excel 升级为模型转述。

### 方案
1. **Skill 注入**：summarize / classify 提示词组装处按文档类型选中对应入库 Skill，
   指导内容注入 system 段
2. **论证单元合并提取**：章节摘要调用同一提示词要求输出
   `{summary, arg_units: [{claim, evidence, logic_pattern, thinker, school}]}`；
   thinker/school 为项目17 溯源预采，零额外成本；解析失败自动降级两次独立调用；
   结果写 arg_units 表并回填 chunk_id（项目15 对齐引擎依赖此关联做单元级嵌入）；
   relation/target_unit_id 留空，项目16 图谱填充
3. **Excel 转述**：source_type=excel 时用表格专用提示词（结构化行列转述为自然语言段落）
4. 新增入库 Skill：`knowledge_base/skills/ingestion/data_table.skill.md`

### 改动范围
- `ingestion/summarizer.py`（注入 + 合并解析 + 降级）
- `ingestion/classifier.py`（注入）
- `ingestion/indexer.py`（arg_units 写入）
- `storage/sqlite_store.py`（arg_units 写入方法）
- `knowledge_base/skills/ingestion/data_table.skill.md`（新建）

---

## 项目 5 · 标准化 .md 生成 + 全文投喂策略

### 目标
入库产物补上人可读的标准化 Markdown；长上下文模型可用时提供第三种摘要策略。

### 方案
1. Stage 8 生成 `STANCES_PATH/{stance}/{doc_id}.md`：frontmatter（标题/作者/坐标/立场）+
   全书摘要 + 章节摘要 + 论证单元列表；删除级联同步覆盖此文件（第六处）
2. `full_context` 策略：文档总 token 低于模型上下文窗口（按服务商能力表，Gemini 类大窗口
   优先）时整书单次投喂；不满足自动回落 Map-Reduce
3. 策略参数：`--summary-strategy auto|map_reduce|refine|full_context`（默认 auto）

### 改动范围
- `ingestion/indexer.py`（Stage 8 + 级联第六处）
- `ingestion/summarizer.py`（full_context + auto 判断）
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
   每条含名称/定义/识别特征，用户可增删
2. `engine/argument_parser.py`：解析提示词注入谬误特征表，输出
   `detected_fallacies: [{name, quote, reason}]`；**一律带"疑似"语义**
3. `engine/rebuttal_engine.py`：检测结果注入反驳提示词（可点名）+ 己方自检约束（零成本）
4. 总开关 `fallacy on|off`（默认 on）；离线模式自动跳过
5. 准确率对策（联网证据：政治辩论语境谬误分类是公认难题）：只做疑似提示，不下断言

### 改动范围
- `knowledge_base/skills/fallacies.md`（新建）
- `models/skill_loader.py`（加载）
- `engine/argument_parser.py`（检测输出）
- `engine/rebuttal_engine.py`（注入 + 自检 + 开关）
- `cli.py` / `api/rebuttal.py`（参数透传）

---

## 项目 7 · 输出参数（风格配置化 + 字数 + 引用导出 + config）

### 目标
风格迁到配置文件并扩充 5 个新风格；字数可控；引用按学术格式导出；Key 配置引擎能力就绪。

### 方案
1. **风格配置化**：新建 `knowledge_base/skills/styles.md`（每风格一节：名称/描述/提示词要点/
   反面演示标记）。STYLES 字典改为启动加载，文件缺失回落内置默认。用户可自行加风格
2. **新增 5 风格**：唯物辩证法（矛盾分析、历史具体、发展眼光）；庸俗辩证法（**反面演示**：
   和稀泥式折中，输出头部固定标注「⚠ 反面演示——这是错误示范」）；归谬法；
   内在批判（只用对方阵营前提和经典打对方）；面向观众（说服目标是围观者）
3. **字数参数**：`length N`（汉字数，上限 2000 超出报错）。显式字数优先于格式默认值；
   提示词按字数档位调整引用密度；超目标 ±30% 仅提示不强制重生成
4. **引用导出**：格式化器输出 GB/T 7714 与 APA；`--cite-format gbt7714|apa|plain`；
   API 响应加 `citations_formatted` 字段
5. **config 能力**：写 Key 到 exe 同目录 `.env`（存在则更新对应行）+ 热重载 PROVIDER_KEYS
   重建路由器立即生效；CLI config 命令保留（开发用），用户界面为项目13 设置页

### 改动范围
- `knowledge_base/skills/styles.md`（新建）
- `engine/rebuttal_engine.py`（STYLES 加载 + 字数 + 引用格式化）
- `models/skill_loader.py`（styles.md 加载）
- `cli.py`（--length / --cite-format / config）
- `api/rebuttal.py`（参数透传）+ `api/`（config 端点，供设置页调用）
- `config.py`（reload 辅助函数）

---

## 项目 8 · 检索升级（搜索模式 + 免费质量评分）

### 目标
搜索方式用户可控；检索质量有客观数字。

### 方案
1. 搜索模式 `keyword|semantic|hybrid|smart`（默认 hybrid）：keyword=仅 FTS5；semantic=仅向量；
   hybrid=现有 RRF；smart=先走 parse 链查询改写再 hybrid
2. 免费两维评分（RAGAS 思路）：上下文相关性 = Top-5 向量相似度均值；
   块利用率 = 生成文本与检索块字符重叠率。写入 Trace-Span 日志，输出尾部附一行
3. 收费两维留 `QUALITY_LLM_EVAL` 开关默认 false，本版不实现调用

### 改动范围
- `engine/retriever.py`（模式分支）
- `engine/reranker.py`（评分 + 日志）
- `cli.py` / `api/`（mode 参数）

---

## 项目 9 · 手动改立场（后端 + CLI）

### 目标
AI 分错立场后用户可改，六处数据同步；项目12 右键菜单直接消费此接口。

### 方案
1. `Indexer.reassign_stance(doc_id, new_stance)` 六处同步：documents.stance、meta.json 移动、
   标准化 .md 移动、INDEX.md 重生成、检索权重自然生效（StanceRouter 每次现算已核实）、
   日志 reassign 事件
2. CLI `reassign <doc_id> <new_stance>`；API `PATCH /api/knowledge/docs/{doc_id}/stance`

### 改动范围
- `ingestion/indexer.py` / `cli.py` / `api/knowledge.py`

---

## 项目 10 · 坐标体系（9 → 22 轴 + 中心点预设）

### 目标
补齐 22 轴意识形态坐标；预设中心点可切换不同国家主流意识形态。

### 方案
1. AXES 按架构 §16.1 补 13 轴（distribution、welfare、democracy_type、organization、
   constitutionalism、identity、gender、secularism、ontology、ecology、ai_automation、
   globalization、historical_view）。原 9 轴必填，新 13 轴尽力而为
2. 逐轴校验：缺轴补 0 并在 meta.json 标 `low_confidence_axes`
3. 中心点：架构 §16.2 的 5 个预置落地为 `knowledge_base/skills/centers.md` 并扩充国家系
   （美国主流、欧盟主流等，22 轴取值+一句说明）；`--center <name>` 让分类与检索加权以该点
   为参照；默认无中心偏移
4. 22 轴提示词分两段避免漏轴；坐标提取仍走本地优先链（敏感任务）

### 改动范围
- `ingestion/classifier.py` / `knowledge_base/skills/centers.md`（新建）/
  `models/skill_loader.py` / `cli.py` / `api/`

---

## 项目 11 · Tauri 桌面应用框架

### 目标
建立窗口软件骨架：三栏布局、引擎后台隐藏启动、流式通信——**交付形态从此没有 cmd 窗口**。

### 方案
1. `desktop/` 新建 Tauri + React 工程（技术栈与赛博史官一致，复用其工程配置经验）
2. **引擎托管**：Tauri 启动时以 sidecar 方式拉起 Python 引擎（PyInstaller exe），
   **子进程隐藏窗口**（遵循 Windows 子进程隐藏 CMD 窗口规范：CREATE_NO_WINDOW），
   健康检查轮询就绪后进入主界面；退出时优雅关停引擎进程
3. 三栏布局：左=知识库树/立场列表，中=主工作区（**可插拔 tab 面板**，为图谱/对比/报告视图
   留插槽），右=引用来源/详情侧栏；左右栏可折叠适配小屏
4. 流式通信：反驳输出直接对接引擎已有 SSE 接口（generate_stream）
5. 端口管理：引擎端口冲突自动递增，前端从 sidecar 握手获取实际端口

### 改动范围
- `desktop/`（新建工程：src-tauri/ + src/）
- `backend/main.py`（就绪信号 + 优雅关停端点）

### 风险
批 6 起点，UI 侧最大风险是 sidecar 生命周期管理（僵尸进程/端口占用）。
缓解：启动加互斥锁，退出双保险（信号 + 超时强杀）。

---

## 项目 12 · 核心界面四件套 + 右键菜单

### 目标
导入、管理、反驳、搜索四大核心流程全部图形化。

### 方案
1. **导入 UI**：拖拽文件/文件夹 → 调批量接口 → 进度条（消费项目3 进度端点）→
   立场确认卡片（显示 AI 推断+置信度+理由，可改）→ 三栏结果报告
2. **知识库管理**：文档列表（按立场分组、显示坐标摘要）、点击预览（标准化 .md 渲染）、删除
3. **反驳输出界面**：论点输入框 + 立场/格式/风格/字数/引用格式选择器 + 流式输出区 +
   右侧引用来源侧栏（点击引用跳原文）+ 谬误标注高亮显示
4. **搜索结果 UI**（按架构 §十七）：文档→章节→段落三级粒度、命中高亮、
   「查看原文」「用作反驳来源」按钮
5. **右键菜单**：注册式设计；本版注册项：修改分类（调 reassign 接口）、用作反驳来源、
   加入对比（供项目15）、编辑/删除论证单元（供项目16 图谱纠错）

### 改动范围
- `desktop/src/`（四个面板组件 + 右键菜单框架）

---

## 项目 13 · 设置与运维界面

### 目标
服务商配置、配额、模型管理、新手引导全部图形化。

### 方案
1. **服务商设置页**：列表显示各服务商状态（调 health）、粘贴 Key 保存（调项目7 config 端点，
   立即生效）、连通性测试按钮
2. **配额状态栏**：底部常驻，引擎新增 `/api/usage` 用量统计（按服务商累计调用次数/token，
   基于现有 Trace-Span 日志聚合）
3. **BGE-M3 模型管理**：显示当前嵌入实现（health 已有 embedder 字段）、一键下载真实模型
   （下载进度条）、下载完成自动切换并提示重建向量（调用重嵌入）
4. **新手引导**：首次启动三步引导（配 Key 可跳过 → 导入演示文档 → 生成第一条反驳）；
   演示知识库用**公版文献**（《国富论》《共产党宣言》公版译本节选）
5. **引用快照约束落地**：本版新增"生成历史"记录时引用存快照（冻结文本+坐标）而非活引用

### 改动范围
- `desktop/src/`（设置页 + 配额栏 + 引导流程）
- `backend/api/`（/api/usage + 模型下载端点）
- `backend/models/embedder.py`（下载器 + 切换重建）

---

## 项目 14 · 知识库打包器（云备份 + 导出/分享）

### 目标
一套打包器两处复用：本地导出分享包 + 云端备份。

### 方案
1. 统一打包格式：SQLite 子集 + 向量（可选）+ meta.json + skills + **分块文本（必含）**
2. 嵌入模型版本标记：接收方版本不匹配时用包内文本重嵌入（复用 §嵌入漂移版本绑定）
3. **隐私红线**：打包强制剥离 `logs/` 与 `.env`；验收 = 解压检查零隐私文件
4. 导入分享包：校验格式 → 查重（走项目2 逻辑）→ 合并入库
5. 云备份：S3 兼容接口（LanceDB 原生 + SQLite 文件上传），凭证存系统凭据管理器不落盘；
   界面提供手动备份/恢复按钮（自动定时备份记为后续债）

### 改动范围
- `backend/storage/packer.py`（新建，打包/解包/校验）
- `backend/api/`（导出/导入/备份端点）
- `desktop/src/`（导出向导 + 备份设置页）

---

## 项目 15 · 论证对齐引擎 + 内部分歧地图 + 跨页对比

### 目标
三个分析功能的共用基建一次建成：论证单元级语义配对。

### 方案
1. **对齐引擎**：arg_units 批量嵌入（复用现有 embedder，向量库新增 units 表）+
   相似度矩阵 + 配对分析（相近论题、对立结论判定走 LLM 轻量调用）
2. **内部分歧地图**（原"冲突检测"重定位）：同立场内配对找"论题相近、结论对立"，
   输出分歧列表——同立场派别分歧是信息不是噪声
3. **跨页对比**：选库内两文档或粘贴两段文本 → 对齐配对 → 分歧表（论点/甲方立场/乙方立场/
   分歧性质）；UI 为主工作区新 tab（消费项目11 可插拔面板）
4. 右键"加入对比"（项目12 已注册）收集对比对象

### 改动范围
- `backend/engine/alignment.py`（新建，对齐引擎）
- `backend/api/`（分歧地图/对比端点）
- `desktop/src/`（对比视图 tab + 分歧地图入口）

---

## 项目 16 · 论点图谱可视化 + URL 自动入库

### 目标
论点关系可视化；网页资料自动入库。

### 方案
1. **图谱数据**：对齐引擎产出的配对关系写 arg_units 的 relation/target_unit_id
   （支持/攻击/细化三类边）
2. **图谱渲染**：成熟库（React Force Graph 或 Cytoscape.js，选包体小者）不自研布局；
   默认按立场/文档过滤 + 同文档节点聚簇展开，不全量渲染；节点右键=编辑/删除论证单元
   （人工纠错入口，消费项目12 注册式菜单）
3. **URL 自动入库**：限公开可读页面；`import <url>` 与界面 URL 输入框共用；
   正文抽取（现有 parsers URL 路径）→ 正文文本哈希查重 → 批量队列三栏报告全部复用
4. 图谱视图为主工作区新 tab

### 改动范围
- `backend/engine/alignment.py`（关系边写入）
- `backend/ingestion/parsers.py`（URL 批量增强）
- `desktop/src/`（图谱 tab）

---

## 项目 17 · 跨立场综合报告 + 论点溯源

### 目标
同一论题的全景分析；论点的思想史渊源追踪。

### 方案
1. **综合报告**：同一论题 × N 立场检索链（复用 RetrievalChain）+ 大汇总调用
   （复用项目5 full_context 判断）；跑前 token 预估提示 + 可选立场子集；
   输出结构：各立场核心论点/最强证据/相互攻击点/共识区
2. **溯源追踪**：对齐引擎 + 文献年代排序；库内文献佐证标"有据"，库外知识一律标
   "模型推测"（UI 异色区分）；消费项目4 预采的 thinker/school 字段
3. 两者均为主工作区新 tab；报告可导出 Markdown

### 改动范围
- `backend/engine/report.py`（新建，综合报告）
- `backend/engine/alignment.py`（溯源排序）
- `desktop/src/`（报告 tab + 溯源 tab）

---

## 项目 18 · 文档、测试与打包收尾

### 目标
版本收口：文档同步、测试补齐、以窗口软件形态重新打包。

### 方案
1. `ARCH-debate-engine.md`：写入本版全部新特性；§十一路线图重写（0.1.1 = 完整桌面软件，
   分期取消，砍掉项移除）；数据库章节补服务器级规范与抽象层设计
2. 测试补齐（引擎侧全部离线可跑）：迁移、查重三分支、批量报告、合并提取降级、谬误开关、
   styles 回落、字数上限、引用格式、搜索模式、reassign 六处、22 轴校验、打包器隐私剥离、
   对齐引擎配对、软删除级联
3. **打包形态切换**：NSIS 主程序 = Tauri 窗口 exe，Python 引擎 onedir 作为资源目录捆入；
   开始菜单/桌面快捷方式指向窗口程序；卸载勾选保留数据逻辑沿用；
   **验收：全程无任何 cmd 窗口闪现**
4. 行数扫描（对照 `Software Architecture.md` §2）+ 越线处置上报
5. Git 提交推送 + 改动台账收口

---

## 验收标准（关键项）

### 引擎侧
1. 同文件两次 import 第二次静默跳过；内容改动后提示新版本，replace 后旧版消失
2. 文件夹导入含坏文件：其余成功，三栏报告正确
3. 含稻草人谬误的论点：输出点名"疑似稻草人谬误"；关开关后不出现
4. 庸俗辩证法输出头部带反面演示标注
5. `length 300` 与 `1500` 长度/引用密度可见差异；`3000` 报错
6. reassign 后立场隔离立即生效，meta.json 与 .md 在新目录
7. migrate 后旧库可检索且摘要缓存未丢（不重烧配额）
8. pytest 全绿（0.1.0 的 43 条 + 新增全部）

### 桌面侧
9. 双击安装包 → 装完打开是**窗口软件**，全程零 cmd 窗口
10. 拖拽一个 PDF → 进度条 → 立场确认 → 入库成功出现在知识库列表
11. 输入论点点生成 → 流式输出 + 右侧引用可点击跳原文
12. 设置页粘贴 Key 保存 → 不重启，服务商状态变可用
13. 右键文档改分类 → 列表分组即时更新
14. 导出分享包解压检查：零 logs/.env；另一台机器（或删库后）导入可检索
15. 图谱 tab 渲染 + 节点右键编辑生效；对比 tab 出分歧表；综合报告含各立场论点与共识区

---

## 改动台账

> 实施时逐批追加：批次 / 文件 / 改动摘要 / 编译与测试结果

### 批 1（项目1 数据地基）—— 44 测试全绿
- `storage/base.py`（新建）：MetadataStoreBase / VectorStoreBase 抽象接口 + get_metadata_store 工厂（决策 9 存储抽象层）
- `storage/sqlite_store.py`：服务器级 schema（documents +content_hash/source_path/created_at/updated_at/deleted_at；arg_units +evidence/thinker/school/relation/target_unit_id；全新库严格外键 ON DELETE CASCADE；覆盖索引 ×5）；WAL + foreign_keys PRAGMA；_MIGRATIONS 表驱动增量列迁移（旧库幂等补列）；upsert_document 改 UPSERT 保 created_at；find_by_hash / find_by_source_path；软删默认 + 硬删级联（子表先删防 CASCADE 计数失真）+ purge_deleted；stats 只计存活；list_arg_units
- `storage/lance_store.py`：VectorStoreBase 改为引用 base；两实现均新增 rename_doc（迁移用）
- `ingestion/indexer.py`：doc_id 改内容哈希（文件哈字节、URL 哈正文；解析先行）；ImportPreview +content_hash；confirm 写 content_hash/source_path
- `config.py`：VERSION="0.1.1" 全局唯一来源；STORAGE_BACKEND；reload_provider_keys 热重载
- `cli.py`：migrate 子命令（五表+FTS+向量+摘要缓存+meta+归档文件+INDEX 同步改写，迁移前自动备份，幂等可重跑）；版本字符串改引用 config.VERSION
- `main.py` / `api/diagnostics.py`：版本改引用 config.VERSION
- `tests/test_storage.py`：级联删除测试改软删+硬删双语义；新增 content_hash/source_path 查询测试（共 44 条）

### 批 2（项目2 查重 + 项目3 批量/断点扩展）—— 46 测试全绿
- `ingestion/indexer.py`：preview 查重前置（exact 短路不烧 LLM；same_path 异 hash → new_version）；语义近重复（全书摘要向量余弦 >0.92 → semantic 提示）；Stage 4/5/6 断点缓存（__doc__ 级 progress 标记 + summaries.json 扩展 doc_summary/coordinates/classification）；import_document 支持 on_duplicate skip/replace/keep-both；estimate() 解析+切块预估（无 LLM 消耗，parsed 可传入 preview 避免双跑）
- `cli.py`：import 支持多源/文件夹递归（SUPPORTED_EXTS 过滤）；批量流程：token 预估确认（--yes 跳过）→ 逐文件异常隔离 → 成功/跳过/失败三栏报告；--on-duplicate 参数；单文件保留交互确认+查重提示
- `api/import_doc.py`：预览响应带 duplicate；confirm 支持 on_duplicate（exact 未选 replace 返 409）；POST /api/import/batch 后台批量 + GET /api/import/progress 进度轮询（供项目12 导入 UI）
- `tests/test_pipeline.py`：新增 TestDedup（exact 跳过 / new_version 检测与 replace），共 46 条

### 批 3（项目4 入库深度分析 + 项目5 标准化md/全文投喂）—— 46 测试全绿
- `ingestion/summarizer.py`：skill_system_messages 按文档类型注入入库 Skill（excel→data_table，回退 default）；summarize_chapter_with_args 合并提取 {summary, arg_units[claim/evidence/logic_pattern/thinker/school]}，解析失败降级两次独立调用；Excel 先转述再分析；summarize_full_context + pick_strategy（auto 按 FULL_CONTEXT_TOKEN_LIMIT 判定）
- `ingestion/classifier.py`：classify_stance 注入入库 Skill（doc_type 参数）
- `ingestion/indexer.py`：Stage 3 改合并提取，缓存升级 {summary, arg_units}（兼容 0.1.0 纯文本旧缓存）；Stage 4 策略分支 auto/map_reduce/refine/full_context；Stage 7b 写 arg_units 表（chunk_id 回填，relation 留空供项目16）；Stage 8b 生成标准化 {stance}/{doc_id}.md（frontmatter+全书总结+章节摘要+论证单元）；删除级联第六处（.md）；preview/import_document 透传 strategy
- `config.py`：FULL_CONTEXT_TOKEN_LIMIT（默认 80000，环境变量可调）
- `cli.py`：--summary-strategy 参数；`api/import_doc.py`：ImportRequest/BatchRequest 加 summary_strategy
- `knowledge_base/skills/ingestion/data_table.skill.md`（新建）
- 修复：批〉编辑吃掉换行导致 SyntaxError（mkdir 行与 meta= 挤同行），复读定位修正；test_resume monkeypatch 目标改 summarize_chapter_with_args

### 批 4（项目6 谬误 + 项目7 输出参数 + 项目8 检索升级）—— 46 测试全绿
- `knowledge_base/skills/fallacies.md`（新建，24 谬误：名称/定义/识别特征，用户可增删）；`styles.md`（新建，8 旧 + 5 新风格：dialectical/vulgar_dialectic反面演示/reductio/immanent/audience）
- `storage/skill_loader.py`：fallacies() + styles() 单文件加载（含注入检测，「反面演示」行识别）
- `engine/argument_parser.py`：detect_fallacies（特征表注入、一律疑似、离线返空、名称白名单校验限 5 条）
- `engine/rebuttal_engine.py`：get_styles 配置化（缺失回落内置）；反面演示头部警示；build_prompt 注入谬误+自检约束+字数要求；generate 加 length（上限 2000 超出报错，偏差±30% 仅提示）/cite_format/fallacy/mode；format_citations GB/T 7714+APA+plain；_char_overlap 块利用率；quality 两维进响应
- `engine/retriever.py`：mode 分支 keyword/semantic/hybrid；`engine/reranker.py`：smart 查询改写（失败回落 hybrid）+ context_relevance 评分写入检索日志 quality 通道
- `models/model_router.py`：reset_router（Key 热重载后重建）
- `cli.py`：rebut --length/--cite-format/--no-fallacy/--mode，输出尾部质量行+疑似谬误栏；search --mode；config 子命令（写 .env+热重载）
- `api/rebuttal.py`：参数透传 + GET /api/rebuttal/options（供项目12 选择器）；`api/settings.py`（新建：GET providers 不回明文 / POST key / DELETE key）挂载 main.py
- 修复：_FALLACY_PROMPT JSON 花括号未转义致 format KeyError；test_hallucination_retry 改 fallacy=False 保持原验证语义；修正工具容错引入的两处错字（道草人→稻草人、兑底→兜底）

### 批 5（项目9 改立场 + 项目10 22轴坐标）—— 46 测试全绿，引擎侧项目 1-10 完成
- `ingestion/indexer.py`：reassign_stance 六处同步（documents.stance/meta.json 移动/标准化 .md 移动/INDEX 重生成/权重天然生效/reassign 日志）
- `ingestion/classifier.py`：AXES 9→22（AXES_CORE+AXES_EXTENDED，两段提示词避免漏轴，两极语义逐轴对照 ARCH §16.1 表格）；扩展轴缺失补 0 + low_confidence_axes 随 coordinates 写入 meta.json
- `knowledge_base/skills/centers.md`（新建）：§16.2 五预设 + 美国主流/欧盟主流，22 轴取值+一句说明（数值为编辑设定参考值，用户可改）；`skill_loader.py` centers() 加载
- `engine/reranker.py`：_center_weight 中心点参照加权（近 +20% 远 -20%，默认无偏移），chain.run 加 center 参数
- `engine/rebuttal_engine.py`：generate/generate_stream 透传 center
- `cli.py`：reassign 子命令；rebut/search --center；`api/knowledge.py`：PATCH /docs/{id}/stance + GET /centers + search 加 mode/center/相关性；`api/rebuttal.py`：center 字段
- 修复：low_confidence_axes 列表混入坐标致 StanceRouter float(list) 爆炸——_doc_coords 源头过滤非数值键；test_full_import 坐标断言 9→22 轴

### 批 6+7（项目11 Tauri 框架 + 项目12 界面四件套 + 项目13 设置）—— 46 测试全绿，真机开窗验证通过
- `desktop/`（新建 Tauri 2 + React 19 + Vite 工程）：
  - `src-tauri/src/lib.rs`：引擎托管（CREATE_NO_WINDOW 隐藏子进程；开发态 venv python cli.py serve / 发布态 engine\DebateEngine.exe serve + KB_PATH 指安装目录）；.engine_port 握手；退出双保险（裸 TCP POST /api/shutdown → 3s 超时强杀）；单实例互斥（二次启动只聚焦）；engine_port/engine_alive 两个 Tauri 命令
  - 前端：`api.ts`（握手轮询 + REST + 手工 SSE 解析）；`App.tsx` 三栏布局（左知识库树按立场分组/中可插拔 tab 注册表/右引用详情栏，左右可折叠）+ 注册式右键菜单（修改分类子菜单/用作反驳来源/加入对比/删除）；反驳面板（SSE 流式 + 谬误标注 + 反面演示警示 + 引用推右栏 + 质量分）；导入面板（Tauri 拖拽取路径 + 文件/文件夹选择器 + URL + 单文件确认卡 + 批量进度条三栏报告）；搜索面板（命中高亮/查看原文/用作来源）；设置面板（Key 不回显、保存即热重载）
- `backend/main.py`：CORS + 端口自增 + .engine_port 就绪信号 + POST /api/shutdown + 父进程看门狗（壳崩溃时引擎 WaitForSingleObject 自杀防孤儿）
- `ingestion/indexer.py`：collect_sources 共用件下沉（CLI 转发）；`api/import_doc.py`：批量端点文件夹自动展开 + 不支持格式预标 skipped + 预览拦目录 422
- 修复（真机测试发现）：① 0.1.0 旧库升级炸——覆盖索引引用新列却先于列迁移执行，拆 _INDEXES 移到 _migrate 之后；② SqliteStore 丢了 check_same_thread=False，FastAPI 线程池跨线程用连接必炸；③ 立场字段 title 非 label，App 统一清洗下发
- 真机验证（截图存证）：开窗零 cmd；三栏渲染；中文立场分组；反驳 E2E（离线兜底 813 字 + 1 引用 + 质量分）；点 X 关窗 → 引擎退出 + 握手文件清除

### 批 8（项目14 知识库打包器）—— 50 测试全绿
- `storage/packer.py`（新建）：debkb/1 格式（manifest + data.json 含必含分块文本 + vectors.npz 可选 + skills/）；白名单打包（logs/.env 结构上进不来）+ verify 黑名单断言双保险；导入合并：内容哈希查重 skip/replace、五表 + FTS 重建、嵌入模型匹配向量直入 / 漂移或缺向量时包内文本重嵌入
- `storage/base.py` + `lance_store.py`：VectorStoreBase.export_doc 接口（两实现）
- `api/kb_package.py`（新建）：POST /api/kb/export|verify|import；main.py 挂载；S3 直传与自动定时备份记后续债（备份到网盘同步目录已可用）
- `desktop SettingsPanel`：导出全库（save 对话框）/ 导入分享包（verify 预检 + 确认 + 报告）
- `tests/test_packer.py`（新建 4 测）：manifest 统计/隐私红线（产物零隐私 + 坏包拒收）/合并幂等查重/嵌入漂移重建

### 批 9+10（项目15 对齐引擎 + 项目16 图谱/URL + 项目17 报告/溯源）—— 57 测试全绿，真机验证通过
- `engine/alignment.py`（新建）：对齐引擎共用基建——单元批量嵌入（claim+evidence，现算现用，向量持久化缓存记债）+ 相似度矩阵配对（每单元限配 3 次）+ LLM 轻量关系判定（离线降级规则法只标 similar 不下结论）；四消费者：分歧地图（同立场跨文档）/跨页对比（两文档或粘贴文本拆句）/关系边写回（relation/target_unit_id）/溯源（年代升序，库内=有据，离线无模型推测段）；graph_data 节点/三类边
- `engine/report.py`（新建）：跨立场综合报告——estimate 预估 + 逐立场 RetrievalChain + 大汇总（四节固定结构）；只报有文档的立场；离线模式明确标注仅罗列检索结果
- `storage/sqlite_store.py`：update_arg_relation / update_arg_unit（白名单字段）/ delete_arg_unit（清悬挂边）
- `api/analysis.py`（新建）：divergence/compare/relations/build/graph/units 编辑删除/trace/report(+estimate)；`api/kb_package.py` 加 save-text（报告 Markdown 真落盘）
- 桌面新增 4 tab（注册表追加）：对比（三模式：两文档/粘贴文本/分歧地图，右键收集清单一键填入）；图谱（react-force-graph-2d：绿支持/红攻击/蓝虚细化，立场/文档过滤，节点右键编辑/删除，生成关系边按钮）；报告（预估确认→生成→导出 md）；溯源（年代链 + 模型推测异色警示）
- `tests/test_alignment.py`（新建 7 测）：确定性关键词嵌入器+关系判定桩；配对/离线降级/分歧地图/写边入图/编辑删除清悬挂/溯源年代序/拆句
- 修复：SettingsPanel 导入 dialog save 与存 Key 函数同名遮蔽（TS 报错）→ 别名 saveDialog/openDialog
- 真机验证：/api/analysis/graph 空库不炸；文本对比配对 1 组；报告预估识别 2 个有文档立场；8 tab 全部渲染（PrintWindow 定向截图，未打扰用户前台）；URL 入库复用 0.1.1 导入链（URL 输入框 + 批量端点已放行 http(s)）
