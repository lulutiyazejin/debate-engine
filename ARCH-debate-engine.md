# 辩论引擎（Debate Engine）架构文档

> 版本：v0.3（用户交互层确认，2026-08-17）
> 定位：带立场的本地 RAG 辩论辅助软件，独立桌面应用（Tauri + React），不依赖外部浏览器宿主。
> 
> > **重要更新**：本版本已纳入系统复盘修正，新增 ParsedArgument 结构化解析、嵌入模型版本绑定、级联删除机制、预置 Skill 包、新手引导、隐私提示六大核心补充。

---

## 一、项目定位

### 核心价值
把别人的论点扔给软件，软件检索本地知识库，以指定立场/意识形态生成有出处的反驳。

### 双支柱定位（0.1.2 起）
1. **个人知识数据库**：看过/没看过、收集来/已有的资料，全部经 AI 入库、整理、数据化；数据可视化（图谱/逻辑链/脉络/矩阵）与统一检索（段落/论点/脉络三视角）是数据库的表现形式。
2. **回应引擎**：以数据库为弹药，对输入言论生成带引用的回应——反驳/批判/评价/分析/综合报告五种意图。

界面按双支柱组织为**双面全屏切换**（知识库面 ⇄ 回应面），见 §8.3 与 `ARCH-UI-reference.md` §〇。

### 0.1.3 能力扩展（详见 PLAN-0.1.3.md）
- **立场体系**：扩至 17 立场，skill 文件位于 `knowledge_base/skills/stances/` 目录扫描自动发现；内容源=政治罗盘球 wiki（中性骨架改写）+ 用户手动导入（立场管理）。
- **元数据全收集**：documents 扩译者/出版社+版次/原著书名+语种/生卒年/学派；入库确认屏一次过目；AI 作者辨认 + 联网三级补充（维基→百科→其他，只补不盖、手动优先、失败显式报告）。
- **模型层**：任务-模型映射表（首填默认）；本地模型一键（Ollama 探测/拉起/pull/下载立即生效）；代理三态 + 本地 bypass。
- **形态**：无外框窗口 + v5 纸感审美全软件落地，见 §8.4。

### 与同类工具的差异
| 对比维度 | 普通 AI 对话 | 本项目 |
|----------|------------|--------|
| 知识来源 | 模型参数（可能幻觉） | 本地资料库（可溯源） |
| 立场 | 隐式、不可控 | 显式、可切换 |
| 引用 | AI 编造 | 从 meta.json 提取真实元数据 |
| 扩展性 | 固定 | 自建 Skill 文件即可新增立场 |

### 软件英文名
`debate-engine`（暂定，打包产物目录名）

---

## 二、整体架构分层

```
┌──────────────────────────────────────────────────────────┐
│                  Layer 1 · 用户交互层                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         独立桌面窗口（唯一 UI 端）                   │  │
│  │         Tauri 2.x + React 18 + TypeScript          │  │
│  └────────────────────────┬───────────────────────────┘  │
└───────────────────────────┼──────────────────────────────┘
                            │ HTTP localhost:7700
┌───────────────────────────▼──────────────────────────────┐
│                  Layer 2 · 辩论引擎层                      │
│                  Python FastAPI（本地 sidecar）            │
│                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐   │
│  │  论点解析器  │ │  立场路由器  │ │   反驳生成器      │   │
│  │ ArgumentParser│ │StanceRouter │ │  RebuttalEngine  │   │
│  └──────┬──────┘ └──────┬──────┘ └────────┬─────────┘   │
└─────────┼───────────────┼─────────────────┼─────────────┘
          │               │                 │
┌─────────▼───────────────▼─────────────────▼─────────────┐
│                  Layer 3 · 知识检索层                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  向量检索     │  │  全文检索     │  │  立场过滤器   │  │
│  │  LanceDB    │  │  SQLite FTS5 │  │  StanceFilter │  │
│  │  BGE-M3 嵌入 │  │  jieba 分词  │  │               │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                  Layer 4 · 知识存储层                      │
│                                                          │
│  /knowledge_base/                                        │
│    ├── stances/          立场分类目录                      │
│    │   ├── liberal/                                      │
│    │   ├── conservative/                                 │
│    │   ├── marxist/                                      │
│    │   ├── empirical/    经验主义/数据派                   │
│    │   └── [自定义立场]/                                  │
│    ├── shared/           跨立场共享资料（事实、数据）         │
│    ├── inbox/            待分类暂存区                      │
│    ├── INDEX.md          全局索引（自动维护）               │
│    ├── skills/           立场 Skill 文件目录               │
│    └── vector_store/     LanceDB 数据目录（支持本地/S3）        │
└──────────────────────────────────────────────────────────┘
```

---

## 三、知识库文档规范

### 3.1 双轨存储格式

每篇文档对应两个文件：

```
doc_001.md              ← 转换后的标准化文档（人工可读）
doc_001.meta.json       ← AI 预处理产物（机器可检索）
doc_001.source.*        ← 原始文件归档（只读备份）
```

### 3.2 标准化文档格式（.md）

```markdown
---
title: 通往奴役之路（节选）
author: Friedrich Hayek
year: 1944
stance: liberal
import_date: 2026-08-17
source_file: hayek_road_to_serfdom.pdf
source_type: book
language: zh
---

## AI 生成摘要
（200字以内，描述核心论点）

## 核心论点
1. 计划经济必然导致权力集中
2. 自发秩序优于顶层设计
3. ...

## 原文分块

### 第1块（p.48-52）
> 原文内容...

### 第2块（p.53-58）
> ...

## 引用关系
- 支持: [洛克, 财产权论述]
- 反对: [凯恩斯, 有效需求理论]
```

### 3.3 元数据格式（.meta.json）

```json
{
  "id": "doc_001",
  "title": "通往奴役之路（节选）",
  "stance": "liberal",
  "secondary_stances": ["empirical"],
  "source": {
    "type": "book",
    "author": "Friedrich Hayek",
    "title": "The Road to Serfdom",
    "year": 1944,
    "publisher": "University of Chicago Press",
    "page_range": "pp.48-52",
    "url": null
  },
  "core_claims": [
    "计划经济必然导致权力集中",
    "自发秩序优于顶层设计"
  ],
  "counter_targets": ["集体主义", "政府管控经济"],
  "keywords": ["市场自由", "哈耶克", "自发秩序"],
  "argument_map": {
    "claim": "市场干预降低效率",
    "evidence_chunks": ["chunk_001", "chunk_003"],
    "rebuttals_against": ["计划经济优越论", "市场失灵论"]
  },
  "chunk_ids": ["chunk_001", "chunk_002", "chunk_003"],
  "import_date": "2026-08-17",
  "quality_score": null
}
```

### 3.4 全局索引（INDEX.md）

自动维护，按立场分组，记录每篇文档的 title/author/year/核心论点摘要。格式：

```markdown
# 知识库全局索引

> 最后更新：2026-08-17 | 文档总数：42 | 立场数：5

## 自由主义（liberal）· 12篇
| 文件 | 作者 | 年份 | 核心论点摘要 |
|------|------|------|------------|
| doc_001 | Hayek | 1944 | 计划经济导致集权... |

## 保守主义（conservative）· 8篇
...
```

---

## 四、Skill 文件规范（立场/意识形态）

每个立场对应 `/knowledge_base/skills/` 下的一个 Markdown 文件。

### 示例：liberal.skill.md

```markdown
# SKILL: 自由主义立场

## 世界观假设
- 个人权利优先于集体利益
- 自发秩序（市场、习俗）优于计划设计
- 负自由（不受干涉的自由）是核心价值
- 政府权力须受宪政约束

## 反驳策略偏好
1. 优先援引实证数据（GDP、自由度指数、贫困率）
2. 引用哈耶克、弗里德曼、洛克等权威原文
3. 攻击对方论证的"不可预见后果"（road to hell paved with good intentions）
4. 指出对方方案的激励机制扭曲
5. 用历史案例（苏联、委内瑞拉）作反例

## 禁止使用的论证方式
- 不使用道德主义说教
- 不诉诸民族主义情感
- 不攻击对方人格

## 知识库检索偏好
- 优先检索: stances/liberal/
- 交叉检索: stances/empirical/（数据支撑）
- 排除: stances/marxist/（立场对立）

## 引用格式偏好
- 学术引用格式: (作者, 年份, 页码)
- 优先书籍 > 学术论文 > 报告 > 新闻

## Prompt 模板
你是一名严格遵循古典自由主义原则的辩手。你相信个人自由、市场自发秩序和有限政府。
在反驳时，你会：
1. 先精确复述对方论点，不稻草人
2. 指出对方论证的逻辑漏洞或前提错误
3. 用本地知识库中的具体文献支撑你的反驳
4. 保持理性克制，不情绪化
```

---

## 五、文件导入管道（Import Pipeline）

### 5.1 支持的格式

| 格式 | 解析库 | 特殊处理 |
|------|-------|---------|
| PDF | `Docling`（结构感知） | 保留标题层级/表格结构；扫描版备选 OCR |
| Word (.docx) | `python-docx` | 保留标题层级用于结构分析 |
| Excel (.xlsx) | `openpyxl` / `pandas` | 表格转自然语言描述 |
| TXT | 直接读取 | 自动检测编码（chardet） |
| Markdown | `python-markdown` | 解析 frontmatter 获取元数据 |
| 网页 URL | `trafilatura` | 自动提取正文，过滤导航栏/广告 |

### 5.2 导入流程

```
① 接收文件 / URL
        ↓
② 格式解析 → 提取纯文本 + 结构（标题/段落/引用）
        ↓
③ 文本分块（Chunking）
   策略：目录/标题边界优先，每块 ≤ 8K tokens；短文章不切割
        ↓
④ AI 预处理（调用 LLM）
   - 生成 200 字摘要
   - 提取核心论点（3-5条）
   - 提取关键词
   - 识别引用关系
        ↓
⑤ 立场自动分类
   - 向量相似度：与各立场"中心向量"对比，输出置信度
   - LLM 辅助分类：给出候选立场 + 理由
   - 输出：[{stance: "liberal", confidence: 0.82}, ...]
        ↓
⑥ 人工确认界面（必须步骤，防止污染）
   ┌──────────────────────────────────────┐
   │ 文档: hayek_essay.pdf                │
   │ AI 推断立场: 自由主义 (82%)           │
   │ 次要立场: 经验主义 (61%)             │
   │ [✓ 确认]  [修改立场]  [多立场归档]   │
   └──────────────────────────────────────┘
        ↓
⑦ 向量化（BGE-M3 嵌入）→ 写入 SQLite（元数据+FTS5）+ LanceDB（向量）
⑧ 生成 meta.json + 标准化 .md
⑨ 归档原始文件到 source.*
⑩ 更新 INDEX.md
```

### 5.3 Excel 特殊处理

表格数据不适合直接向量检索，AI 需先转换：

- 输入：各国基尼系数表格（2010-2020）
- 输出描述："该表格记录了2010年至2020年各国基尼系数变化。中国从0.47下降至0.46，趋势平稳；美国从0.40上升至0.43，贫富差距扩大；北欧国家普遍维持在0.25-0.30区间..."

---

## 六、RAG 检索链（带立场）

### 6.1 完整检索流程

```
① 接收对方论点（自然语言）
        ↓
② 论点解析（ArgumentParser）
   - 提取核心主张
   - 识别论证结构（三段论 / 类比 / 诉诸权威 / 情感诉诸）
   - 标记可攻击弱点（前提错误 / 逻辑跳跃 / 数据缺失）
        ↓
③ 立场选择（StanceRouter）
   - 用户手动指定，或
   - 自动推断最优反驳立场（分析对方论点所属立场，选对立立场）
        ↓
④ 混合检索（Hybrid Retrieval）
   阶段A - 粗检索：
     向量检索（LanceDB cosine）  → Top-20 候选块
     SQLite FTS5 全文检索      → Top-20 候选块
     RRF 融合排序                → Top-30
   
   阶段B - 立场精排（Reranking）：
     按 Skill 文件中的"检索偏好"调整权重
     优先目标立场的文档（权重×1.5）
     降权对立立场的文档（权重×0.3）
     保留共享区文档作为事实支撑（权重×1.0）
     → Top-5 最终候选
        ↓
⑤ 反驳生成（RebuttalEngine）
   注入：Skill Prompt + Top-5 检索块 + 原始论点
   要求输出：
     - 主论点（1-3句，精准回应）
     - 支撑证据（来自哪篇文档哪个分块，含页码）
     - 逻辑链（为什么这个证据能反驳对方）
     - 延伸攻击（对方可能的再回应及预防）
        ↓
⑥ 格式化输出（按用户选择的模式）
```

### 6.2 防幻觉机制

LLM **不允许**生成引用元数据。引用信息强制从 `meta.json` 注入：

```python
# 构建 prompt 时的引用注入
for chunk in top_chunks:
    source = chunk.meta["source"]
    citation = f"[{source['author']}, {source['year']}, {source.get('page_range', '')}]"
    prompt += f"\n 引用来源：{citation}\n 内容：{chunk.text}\n"
```

输出时要求 LLM 只能使用已注入的引用标识符，不得自行编造新引用。

### 6.3 论点解析（ParsedArgument）

对方论点需结构化解析后再检索，避免直接嵌入导致语义丢失：

```json
{
  "core_claim": "最低工资不导致失业",
  "conditions": ["前提：工资水平不过高"],
  "negations": ["否定：失业"],
  "implicit_target": "最低工资就业影响",
  "attack_surface": ["条件范围模糊", "数据依赖"]
}
```

- `implicit_target` → 用于检索相关反驳材料
- `attack_surface` → 用于针对性构建论证链
- `conditions` + `negations` → 防止稻草人谬误

---

## 七、输出维度系统（格式 × 风格）

输出有两个**相互独立**的维度，用户可任意组合：

### 7.0 两个维度说明

```
维度 A：输出格式（怎么排版）  ×  维度 B：回复风格（用什么态度）

示例组合：
  论证模式 × 批判风格  → 结构化段落，专攻对方的理论前提
  速辩模式 × 评价风格  → 三句话，承认部分合理，指出局限
  报告模式 × 无风格    → 论文结构，纯呈现相关资料，不下结论
```

### 7.1 回复风格（8 种）

| 风格 | 核心目标 | 语气 | 检索倾向 | 适合场景 |
|------|---------|------|---------|--------|
| **反驳** | 直接否定对方论点 | 对抗性但有据 | 反驳证据为主 | 实时辩论 |
| **批判** | 攻击对方论证的理论前提和逻辑结构 | 解析性，可带蔑视 | 质疑前提的理论文献 | 学术批评 |
| **评价** | 客观评估对方论点的优缺点 | 中立偏批评 | 正反两面均取 | 学术写作、公平讨论 |
| **分析** | 拆解论点结构，不表态 | 完全中立 | 逻辑结构分析资料 | 论点预处理、研究备忘 |
| **质疑** | 提出问题而不给出反驳 | 好奇/存疑 | 不确定领域和争议焦点 | 苏格拉底对话前置 |
| **苏格拉底式** | 用提问引导对方自相矛盾 | 表面顺从实则引导 | 对方世界观内部的逻辑漏洞 | 高阶辩论技巧 |
| **补充** | 扩展或限定对方论点而非反对 | 建设性 | 支撑性资料 + 补充语境 | 协作讨论 |
| **无风格** | 直接呈现知识库相关材料，不加框架 | 纯信息性 | 相关度为主，不考虑立场 | 纯研究模式 |

**无风格模式的检索特殊处理**：

```python
def build_retrieval_config(stance: str, style: str) -> RetrievalConfig:
    if style == "neutral":
        return RetrievalConfig(
            stance_filter=None,      # 不过滤立场
            stance_boost=1.0,        # 无立场加权
            prompt_template="neutral"  # 不注入立场 Prompt
        )
    else:
        return RetrievalConfig(
            stance_filter=stance,
            stance_boost=1.5,
            prompt_template=get_skill_prompt(stance, style)
        )
```

### 7.2 风格与格式的兼容矩阵

```
              速辩   论证   报告
反驳           ✓      ✓      ✓
批判           ✓      ✓      ✓
评价           △      ✓      ✓
分析           △      ✓      ✓
质疑           ✓      △      ✗
苏格拉底式     ✓      △      ✗
补充           △      ✓      ✓
无风格         ✗      ✓      ✓

✓ 非常适合  △ 可用  ✗ 不推荐
```

### 7.3 与 Skill 文件的集成

每个立场 Skill 预设一个默认风格，用户可逐次覆盖：

```markdown
## 默认回复风格
批判（优先揭示对方的阶级立场和制度本质）

## 各风格的处理偏好
- 反驳：援引历史唯物主义，指出对方方案的阶级局限
- 批判：从生产关系基础攻击对方的上层建筑逻辑
- 评价：分析对方改良方案能解决什么，无法解决什么
- 无风格：不适用（带立场知识库不适合无立场输出）
```

### 7.4 API 接口更新

```yaml
POST /api/rebuttal
  Request: {
    argument: str,
    stance: str,
    response_style: "rebuttal|critique|evaluation|analysis|questioning|socratic|supplement|neutral",
    output_mode: "quick|argument|report"
  }
```

### 7.5 输出格式三种模式

三种格式由用户在 UI 中选择，可随时切换：

### 速辩模式（Quick）
适用于实时辩论、即时反驳
```
哈耶克指出，计划经济不可避免地导致权力集中（1944, p.51）。
你的论证忽略了激励机制扭曲的问题：当价格信号被压制时，
资源分配效率必然下降，这在苏联的历史数据中已有充分验证。
```

### 论证模式（Argument）
适用于书面辩论、深度回应
```
## 反驳：[对方核心主张]

根据哈耶克（1944）的论述，...（2-3段结构化论证）

**逻辑漏洞**：对方的论证存在以下前提错误...

**来源**：Hayek, F. (1944). *The Road to Serfdom*. p.51.
```

### 报告模式（Report）
适用于学术写作、研究备忘
```
# 论题分析报告：[议题]

## 摘要
## 对方论点还原
## 立场声明（自由主义）
## 反驳论证
   ### 论点一
   ### 论点二
## 结论
## 参考文献
   [1] Hayek, F. A. (1944). The Road to Serfdom...
   [2] ...
```

---

## 八、前端架构

### 8.1 V1.0：独立 Tauri 桌面应用

技术栈：`Tauri 2.x` + `React 18` + `TypeScript`

界面分区：
```
┌──────────┬─────────────────────────────┬──────────────┐
│          │  输入区                      │  来源引用区  │
│  侧边栏  │  [对方论点输入框]             │  文档列表   │
│          │  [立场选择器]  [输出模式]     │  可点击预览 │
│  立场列表│  [生成反驳] 按钮             │             │
│  文档管理│─────────────────────────────│             │
│  设置    │  输出区                      │             │
│          │  反驳结果（支持复制/导出）    │             │
│          │                             │             │
└──────────┴─────────────────────────────┴──────────────┘
```

### 8.2 界面三栏布局（确认方案）

```
┌──────────┬───────────────────────────┬──────────────┐
│          │  输入区                      │  来源引用区  │
│  侧边栏  │  [对方论点输入框]             │  命中文档列表│
│          │  [立场] [风格] [格式] 选择器  │  可点击预览  │
│  知识库  │  [生成反驳] 按钮             │  跳转原文    │
│  立场列表│───────────────────────────│             │
│  辩论历史│  输出区                      │             │
│  设置    │  反驳结果（流式显示）          │             │
│          │  [复制] [加入备稿本] [重试]   │             │
└──────────┴───────────────────────────┴──────────────┘
[底部状态栏] Groq █████░  58%   Gemini ███░░  56%   Cerebras █░░░░  31%
```

底部状态栏（QuotaBar 组件）常驻显示各 AI 服务商配额用量，白/黄/红三色预警。

### 8.3 双面全屏布局（0.1.2 确认方案，取代 8.1/8.2 三栏）

软件收敛为两个全屏互斥的"面"，与双支柱一一对应：

```
🗄 知识库面                              ⚔ 回应面
┌ 🔍 全局检索框（段落|论点|脉络三视角）┐    ┌ 素材篮 │ 输入→意图（反驳|批判|  │页边注┐
│ 立场树 │ 画布：列表|图谱|逻辑链|脉络 │档案卡│    │ +历史  │ 评价|分析|综合报告）  │(引用/│
└───────┴──────────────────────┴────┘    └ 收藏   │ ──输出（72ch）──      │谬误) ┘
```

- **切换四通道**：右上悬浮组主钮（200ms 滑动）/ 长按右键滑动 ≥120px（跟手，<10px 放行右键菜单）/ Ctrl+Tab（瞬切）/ Ctrl+K 命令面板（带参切换）；快捷键可自定义（localStorage，系统保留键冲突检测）
- **设置 = 全屏覆盖浮层**（悬浮组齿轮 / Ctrl+,），六分区：模型服务商（含自定义 OpenAI 兼容服务商与任务分工总览）/ 生成检索参数 / 知识库 / 知识文件 / 诊断日志 / 界面
- **素材篮**：唯一跨面通道，知识库面收集（引擎侧持久化表，不入分享包）→ 回应面作为强制引用候选注入（material_ids）
- **三态主题**：深 / 浅（纸感）/ 跟随系统；窗口标题栏经 Tauri setTheme 随主题，首帧无白闪
- 两面常驻不卸载；QuotaBar 由设置页"诊断与日志"分区先行兑现统计功能
- 视觉语法（呼吸感 token/lieflat 数据元素）详见 `ARCH-UI-reference.md` §〇

---

### 8.4 无外框窗口（0.1.3，取代 8.3 的外框部分）

- `decorations:false` + `shadow:true`；顶部功能条（应用标+双面 tab+检索+功能组+自绘最小化/最大化/关闭）即拖动区，双击=最大化/还原
- 自绘控制钮：关闭钮悬停=全软件唯一红色落点；winctl 最高 z-index，设置浮层不遮
- 代价：Windows 贴边分屏失效（接受，不记债）；红利：标题栏完全归软件，白标题栏问题根除
- 视觉总纲见 `ARCH-UI-reference.md` §0.6–0.10（v5 纸感审美+交互词汇+图型+图标字体规范），目标态样张=design-preview-frameless.html

## 九、后端架构（Python FastAPI）

### 9.1 目录结构

```
debate-engine-backend/
  ├── main.py                  FastAPI 入口，路由注册
  ├── config.py                配置管理（API Key、模型选择、路径）
  ├── api/
  │   ├── rebuttal.py          /api/rebuttal  反驳生成接口
  │   ├── import_doc.py        /api/import    文档导入接口
  │   ├── knowledge.py         /api/knowledge 知识库管理接口
  │   └── stances.py           /api/stances   立场/Skill 管理接口
  ├── engine/
  │   ├── argument_parser.py   论点解析器
  │   ├── stance_router.py     立场路由器
  │   ├── retriever.py         混合检索（LanceDB 向量 + SQLite FTS5）
  │   ├── reranker.py          立场精排
  │   └── rebuttal_engine.py   反驳生成器
  ├── ingestion/
  │   ├── parser_pdf.py        PDF 解析
  │   ├── parser_docx.py       Word 解析
  │   ├── parser_excel.py      Excel → 自然语言描述
  │   ├── parser_url.py        网页正文提取
  │   ├── chunker.py           文本分块
  │   ├── classifier.py        立场自动分类
  │   └── indexer.py           向量化 + 入库 + INDEX.md 更新
  ├── models/
  │   ├── llm_client.py        LLM API 统一适配层（OpenAI / Groq / Gemini / Ollama）
  │   └── embedder.py          BGE-M3 嵌入模型（本地运行）
  ├── knowledge_base/          知识库数据目录（运行时）
  └── skills/                  Skill 文件目录
```

### 9.2 LLM 适配层

统一 OpenAI 格式，支持多后端无缝切换：

```python
# config.py 配置项
LLM_PROVIDER = "openai"  # openai | anthropic | ollama | deepseek
LLM_BASE_URL = "https://api.openai.com/v1"
LLM_MODEL = "gpt-4o"
LLM_API_KEY = "sk-..."
```

### 9.3 核心 API 接口

```
POST /api/rebuttal
  Request:  { argument: str, stance: str, output_mode: "quick|argument|report" }
  Response: { rebuttal: str, sources: [{title, author, year, page, chunk_text}], 
              attack_points: [str], logic_chain: str }

POST /api/import
  Request:  { file_path: str } | { url: str }
  Response: { doc_id: str, detected_stance: str, confidence: float, preview: {...} }

POST /api/import/confirm
  Request:  { doc_id: str, stance: str }
  Response: { status: "indexed", index_updated: bool }

GET  /api/knowledge/stances
  Response: { stances: [{name, doc_count, description}] }

GET  /api/knowledge/docs?stance=liberal
  Response: { docs: [{id, title, author, year, core_claims}] }
```

### 9.4 数据完整性保障

**嵌入模型版本绑定**：防止向量空间漂移，每个向量记录生成模型名称和维度，查询时自动检查版本一致性，不匹配则提示重建索引。

**级联删除机制**：删除文档时必须同步清除五个数据源（documents / chunks / arg_units / fts_index / LanceDB 向量），任何一步遗漏将导致僵尸数据污染检索结果。

**入库队列状态管理**：断点恢复，记录每章节的展开阶段和完成状态。重新入库时自动跳过已完成的步骤，避免重复消耗 API 额度。

---

## 十、技术选型汇总

| 组件 | 选型 | 理由 |
|------|------|------|
| 前端框架 | Tauri 2.x + React 19 + Vite 7 | 独立桌面应用，唯一 UI 端；引擎为隐藏 sidecar |
| 后端框架 | Python FastAPI | AI/NLP 生态最成熟 |
| 结构化存储 | SQLite（WAL + FTS5，服务器级 Schema） | 内容哈希查重/软删除/断点恢复；抽象层可换 PostgreSQL |
| 向量数据库 | LanceDB（缺依赖时 Numpy 实现兜底） | 本地优先，VectorStoreBase 抽象可扩展 |
| 图谱可视化 | react-force-graph-2d | 论证单元力导向图，包体小于 Cytoscape |
| 嵌入模型 | BGE-M3（本地 ONNX） | 中英双语，支持完全离线，1024维 |
| 全文检索 | SQLite FTS5 + jieba | 向量检索的关键词互补，中文分词 |
| 文档解析 | Docling（IBM 开源） | 结构感知 PDF 解析，本地运行 |
| PDF 查看器 | PDF.js（Mozilla 开源） | 内嵌查看，关键词高亮跳页 |
| Word 解析 | python-docx | 官方库，保留文档结构 |
| 网页提取 | trafilatura | 自动过滤导航/广告，正文精度高 |
| LLM 接口 | 统一 OpenAI 格式适配层 | 兼容 GPT / Groq / Gemini / Ollama |
| 编码检测 | chardet | TXT 文件中文编码自动识别 |
| 3D 可视化 | React Three Fiber | 意识形态立方体，OrbitControls |

---

## 十一、版本路线图

### V1.0 · 核心引擎（CLI 验证阶段）—— ✅ 已完成（0.1.0，2026-08-17 打包发布）
- [x] Python 后端：文档解析 + 向量化 + RAG 检索
- [x] 立场分类器（自动 + 人工确认）
- [x] 第一批 Skill 文件（5个立场 + 5个入库类型）
- [x] 反驳生成（三种输出模式 × 八种风格）
- [x] 命令行 CLI 验证检索质量

### V1.1 · 完整桌面软件 —— ✅ 已完成（0.1.1，单版本交付 18 个项目）
- [x] Tauri 2 + React 19 桌面窗口（三栏布局，8 功能页，零 cmd 窗口）
- [x] 引擎隐藏 sidecar：端口握手文件 + 优雅关停 + 父进程看门狗双保险 + 单实例互斥
- [x] 服务器级 Schema：内容哈希查重/软删除/断点恢复/覆盖索引（迁移后建）
- [x] 存储抽象层：SQLite 默认 + 向量库 Lance/Numpy 双实现 + export_doc
- [x] 文档导入 UI（拖拽/文件夹/URL + 实时进度 + 立场确认）
- [x] 知识库树（右键：改立场/作为反驳对象/收集对比/删除）
- [x] 反驳流式输出 + 引用侧边栏 + 谬误检测 + 质量度量
- [x] API 服务商配置页（Key 管理，ollama 自动探测）
- [x] 知识库导出/导入分享包（debkb/1，隐私红线 + 查重合并 + 嵌入漂移重建）
- [x] 对齐引擎：分歧地图/跨页对比/关系边/溯源（engine/alignment.py）
- [x] 论证图谱可视化（react-force-graph-2d，节点右键纠错）
- [x] 跨立场综合报告（token 预估确认 → 四节固定结构 → Markdown 导出）
- [x] NSIS 安装包：Tauri 壳为主程序 + engine\ 子目录隐藏引擎
- 未入本版（记债）：BGE-M3 本地模型管理、新手引导、QuotaBar、单元向量持久化缓存

### V1.2 · UI 全面重构（0.1.2，进行中）—— 详见 PLAN-0.1.2.md，24 项目 7 批
- [ ] 双面全屏切换骨架（知识库面 ⇄ 回应面；悬浮组/右键滑动手势/Ctrl+Tab/命令面板）
- [ ] 视觉 token 层 + 呼吸感六原则 + lieflat 数据元素（StatHead/TickBar/LedgerList/页边注）
- [ ] 三态主题（深/浅/跟随系统，窗口标题栏随主题）
- [ ] 搜索+溯源合并为检索区（段落/论点/脉络三视角）；脉络时间轴（泳道 DAG）
- [ ] 图谱三栏联动（聚焦邻域/关系 chips/渐进展开/论点档案卡）+ 逻辑链视图
- [ ] 回应意图一级化（反驳/批判/评价/分析/综合报告）+ 素材篮 + 回应历史收藏 + 回应存入知识库
- [ ] 关系集扩展（+演进/类比/同题对立）
- [ ] 报告整页 HTML（纸感、零 CDN）；设置页重构（自定义服务商/任务分工总览/诊断/界面）

### V1.3 · 纸感审美统一 + 能力补全（0.1.3，进行中）—— 详见 PLAN-0.1.3.md，26 项目 5 批
- [ ] 无外框窗口 + 功能条 + 自绘控制钮；桌面图标（四书堆纸白版）
- [ ] v5 纸感审美全软件落地（tokens/控件发丝线化/G6 换皮/逻辑链流程图/时间轴条码/卡片堆栈/空态线描）
- [ ] 交互词汇（160/240/400ms ease-out、静止零动画、呼吸点、stagger、悬停墨色阶）
- [ ] 元数据全收集 + AI 作者辨认 + 联网三级补充（失败显式报告、手动标优先）
- [ ] 任务-模型映射表 + 本地模型一键（Ollama）+ 代理三态（本地 bypass）
- [ ] 立场体系扩 17（12 波兰球源 skill 预置）+ 立场管理（手动导入 skill）
- [ ] 字体外挂 / 窗口记忆 / 版本信息区 / bump 脚本 / 连通诊断

### V2.0 · 高级功能（剩余部分）
- [x] 论点图谱可视化（已入 0.1.1）
- [x] 自动资料入库（URL 导入已入 0.1.1；批量爬取待做）
- [x] 立场冲突检测（分歧地图已入 0.1.1）
- [ ] 反驳强度评分（0-10分 + 理由）
- [ ] 多轮辩论推演（模拟对方再回应）

### V2.5 · 训练与协作
- [ ] 苏格拉底模式（反问引导，不直给答案）
- [ ] 辩论训练模式（AI 扮演对手，点评论证质量）
- [x] 知识库导出/分享（debkb 格式已入 0.1.1）

### V3.0 · 思想图谱（剩余部分）
- [x] 跨立场综合报告（已入 0.1.1）
- [x] 论点溯源追踪（已入 0.1.1；模型推测段异色标注）
- [x] 跨页面论点对比（已入 0.1.1）
- [ ] 实时辩论辅助（语音输入 + 实时耳返）

---

## 十二、风险与约束

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| LLM 幻觉生成虚假引用 | 反驳不可信 | 引用元数据强制从 meta.json 注入，LLM 只负责语言组织 |
| 资料库质量低 | 反驳质量差 | 设计文档质量评级机制；入库前 AI 评分 |
| 嵌入模型换代 | 已有向量全部失效 | 记录 embedding 模型版本；切换时触发全量重建提示 |
| 立场分类错误 | 污染整个立场检索 | 人工确认为必须步骤，不可跳过 |
| Tauri sidecar 进程管理 | Python 进程崩溃影响前端 | sidecar 心跳检测，崩溃自动重启，前端降级提示 |
| Python sidecar 启动慢 | 用户体验差 | 后台预启动；BGE-M3 模型懒加载（首次检索时才加载） |

---

## 十三、开发约定

- **编译门禁**：每批改动边界跑 `mypy` 类型检查 + `pytest` 单元测试
- **死码清理**：每个 parser 模块必须有对应单元测试（至少一个正常路径 + 一个异常路径）
- **引用防幻觉测试**：RebuttalEngine 必须有测试断言：输出中的每个引用标识符都在注入 context 中存在
- **立场污染测试**：立场过滤器必须有测试断言：liberal 立场检索不返回 marxist 文档
- **文档优先**：每个 Skill 文件必须有人工审核，不接受纯 AI 生成

---

*本文档随项目推进持续更新。*

---

## 十四、模型路由器（Model Router）

### 14.1 任务分类与优先级链

| 任务类型 | 默认优先级链 | 选择逻辑 |
|------|-------------|--------|
| 章节摘要 | Gemini 3 Flash → Cerebras → Groq | 非敏感，默认免费联网 |
| 意识形态坐标分析 | Ollama → Groq DeepSeek-R1 → Mistral | 敏感内容，本地优先 |
| 反驳生成 | Groq Qwen3-32B → Gemini 3 Flash | 速度敏感，LPU 最快 |
| 论点解析 | Groq → Ollama | 中频，跟随反驳设置 |
| 立场分类 | Ollama → Groq | 敏感，本地优先 |

### 14.2 降级触发规则

| 错误类型 | 处理方式 |
|------|----------|
| 429 限速 | 切换同类型下一个服务商 |
| 400/内容过滤 | 直接切换本地模型，跳过其他云端 |
| 超时 | 切换更快的服务商 |
| 余额不足 | 切换到完全免费模型 |
| 全部失败 | 暂停并提示用户手动处理 |

### 14.3 支持的免费 API（永久免费层）

| 服务商 | 免费额度 | 限制 | 特点 |
|------|---------|------|------|
| **Gemini（Google AI Studio）** | 1,500 次/天 | 10 次/分钟 | 支持 PDF 直传，100万上下文 |
| **Groq** | 14,400 次/天 | 30 次/分钟 | 最快（LPU），Llama/Qwen/DeepSeek |
| **Cerebras** | 100万 tokens/天 | 8K 上下文 | tokens 最多 |
| **Mistral** | 免费评估模式 | 账号限制 | 欧洲服务器，内容审查较宽松 |
| **OpenRouter（:free）** | 200 次/天 | 20 次/分钟 | 18 个免费模型，包含 uncensored |

**每日免费处理上限估算**：三个服务轮换使用，每天可处理非敏感内容平均 80-100 本书的章节摘要。

### 14.4 自定义服务商添加

支持任意 OpenAI 格式兼容的第三方 API（硬基流、阳云百炼、Together AI 等）。配置项：名称、API 地址、API Key、模型列表（自动获取或手动输入）。

---

## 十五、文档入库四阶段流水线（升级版）

```
Stage 0：Docling 结构提取（完全免费）
  输入：PDF/Word/URL
  输出：章节结构树 + 表格结构化 JSON
  工具：Docling（本地）
  注意：表格单元保留结构，不扑平为字符串

Stage 1：本地切割（完全免费）
  优先级：第一级标题/目录书签 > H2 标题 > 语义边界检测
  处理：过长章节按 H2 细分，小于 8K tokens
  特殊处理：表格→AI 转述性文字，短文章不切割

Stage 2：BGE-M3 向量化（本地，无 API 费用）
  小模型就辛全套，3GB、每秒处理 500+ 段

Stage 3：章节摘要（免费 API为主）
  最优：Gemini 3 Flash（支持 PDF 直传，跳过 Docling）
  降级：Cerebras → Groq
  每章节独立处理，并行执行
  输入：单章内容（< 8K tokens）
  输出：150字摘要 + 核心论点列表 + 关键词

Stage 4：全文分析（免费 API为主）
  输入：所有章节摘要拼合（例：18章 × 150字 = 2,700 tokens）
  适用模型：Groq Qwen3-32B（足够）
  输出：全书立场坐标（与五个字段）+ 批判对象 + 核心主张
  敏感内容：自动降级到 Ollama（绕过云端）
```

**全书总结策略选择：**

| 策略 | 适用场景 | Token 消耗 | 特点 |
|------|--------|------------|------|
| Map-Reduce | 章节独立的实证类著作 | 最小 | 并行快据但跨章连贯性弱 |
| Refine Chain | 逻辑递进的理论著作 | 中等（逐步累积） | 保留前后章节论证关系 |
| Gemini 全文 | 重要核心文献 | 消耗一次配额 | 最准确，不丢失任何信息 |

---

## 十六、意识形态坐标系统与 3D 可视化

### 16.1 完整 22 轴列表

全量坐标在入库时提取，所有轴均写入 `meta.json`，不论用户是否启用：

| 轴名 | 负端（-5） | 正端（+5） |
|------|---------|----------|
| **ownership** ★ | 公有制 | 私有制 |
| **political_authority** ★ | 威权 | 自由 |
| **imperialism** ★ | 反帝 | 帝国主义 |
| epistemology | 教条主义 | 经验主义 |
| change_speed | 革命激进 | 渐进改良 |
| ethics | 后果主义 | 义务论 |
| culture | 传统主义 | 进步主义 |
| diplomacy | 孤立主义 | 国际主义 |
| technology | 技术悲观 | 技术乐观 |
| distribution | 平均主义 | 绩效主义 |
| welfare | 强福利国家 | 自力更生 |
| democracy_type | 直接民主 | 精英代议 |
| organization | 先锋党纪律 | 无政府自组织 |
| constitutionalism | 人治/党治 | 宪政法治 |
| identity | 阶级政治优先 | 身份政治优先 |
| gender | 父权传统 | 女权/性别流动 |
| secularism | 政教合一 | 彻底世俗 |
| ontology | 整体主义 | 原子个人主义 |
| ecology | 生态中心/深绿 | 人类中心/发展优先 |
| ai_automation | 技术恐惧 | 加速主义 |
| globalization | 反全球化 | 亲全球化 |
| historical_view | 唯物决定论 | 观念/意志论 |

★ 表示默认三轴（初始 3D 立方体）

### 16.2 3D 立方体可视化

- **目标模块**：三轴均可配置，深色 = 默认（ownership / political_authority / imperialism）
- **技术栈**：React Three Fiber + OrbitControls，鼠标拖动旋转、滚轮缩放
- **8 个顶点**：对应该坐标系下的能有的较纯粹意识形态组合，标注对应的政治形态名称
- **坐标点**：各立场 / 各论证单元为彩色圆点，悬停显示名称和坐标值，点击可进入详情
- **中心点可配置**：所有坐标相对于选定的意识形态为原点重新排列

**预置中心点（坐标平移原点）：**

| 预设名称 | 说明 |
|----------|------|
| **日子人 / 社民（默认）** | 代表当代多数人的隐性默认立场 |
| 社会民主主义 | 欧式福利主义语境下的中间状态 |
| 古典自由主义 | 哈耶克、弗里德曼为代表 |
| 马列毛主义 | 马克思主义最正统视角 |
| 中国主流 | 当代中国社会主流共识 |

---

## 十七、搜索系统

> 0.1.2 起：搜索与溯源**合并为知识库面检索区**——一次查询三视角（段落=本节混合检索；
> 论点=对齐引擎相近论证单元；脉络=年代泳道时间轴），筛选栏（立场/年代/来源定位）三视角同时生效；
> 结果动作：查看原文 / 图谱聚焦 / 加入素材篮（支持多选批量）。以下四模式为段落视角的底层设计。

### 17.1 四种搜索模式

| 模式 | 底层技术 | 典型用法 |
|------|---------|--------|
| 关键词全文搜索 | SQLite FTS5 + jieba 分词 | “市场信号”、“哈耶克” |
| 展每语义搜索 | LanceDB 向量检索 | “为什么自由市场更高效” |
| 来源定位 | SQL 相似/精确查询 | “哈耶克 1944 ”、“通往奴役之路” |
| 立场筛选 | SQL WHERE + 坐标范围查询 | 勾选意识形态、年份范围 |

搜索结果展示三级粒度：文档→章节→具体段落（含黄色关键词高亮），每条结果附带“查看原文”和“用作反驳来源”两个操作按钮。

### 17.2 混合检索与分层索引

层级：文档级粗筛（Top 200）→ 章节级精排（Top 50）→ Chunk 级最终（Top 5）。FTS5 关键词 + 向量语义 两路并行，通过 RRF（倒数秩融合）排序合并。

---

## 十八、文档查看器

### 18.1 三种打开方式（设置内可切换）

| 方式 | 表现 | 适用格式 |
|------|------|--------|
| 内置查看器 | PDF.js 渲染，跳转匹配页码并高亮 | PDF、TXT、MD |
| 系统默认程序 | shell 调用系统已安装的软件 | Word、Excel 等 |
| 打开所在文件夹 | 启动资源管理器并选中该文件 | 所有格式 |

内置 PDF 查看器支持关键词高亮定位：搜索命中具体页码后，点击结果直接跳转至 PDF 对应页并高亮匹配文字。

---

## 十九、预置 Skill 包与开箱体验

### 19.1 软件预置的 Skill 文件（开箱就有）

**辩论立场 Skill （V1.0 预置包）：**

| 文件名 | 覆盖立场 | 相互对立立场 |
|---------|--------|-----------|
| `liberal.skill.md` | 古典自由主义 | 马克思主义、集体主义 |
| `marxist.skill.md` | 马列毛主义 | 自由主义、资本主义 |
| `conservative.skill.md` | 保守主义 | 进步主义、左派改革 |
| `social_democracy.skill.md` | 社会民主主义 | 市场原教旨主义、极左 |
| `empirical.skill.md` | 数据派/经验主义 | 教条主义、单纯规范论 |

**入库 Skill （V1.0 预置包）：**

| 文件名 | 适用文档类型 |
|---------|----------|
| `political_theory.skill.md` | 各类政治哲学著作 |
| `academic_paper.skill.md` | 学术论文（IMRaD格式） |
| `news_article.skill.md` | 新闻、评论、博客 |
| `historical_document.skill.md` | 历史文献、传记 |
| `default.skill.md` | 通用兕底，所有类型均可处理 |

### 19.2 演示知识库（开箱就有）

预载入预处理好的 10-15 篇经典文献摘要，涵盖 5 个预置立场，让用户开箱就能体验完整的反驳工作流，无需导入任何文档。

### 19.3 新手引导流程（首次启动）

> **开发者注意**：默认屏蔽新手引导。在 `localStorage` 设置 `dev_skip_onboarding=true`（生产构建时自动写入）即可跳过，直接进入主界面。

```
首次启动 → 欢迎界面（生产模式才显示）

第一步：配置 AI 模型（必选一个）
  [免费：Groq 免费 API]
  [免费：Gemini AI Studio]
  [免费：Cerebras 免费 API]
  [本地：安装 Ollama 延迟配置]
  [暂跳过：使用演示模式（不能入库新文档）]

第二步：正在下载内置嵌入模型（BGE-M3，3GB）
  [进度条显示：正在下载... 45%]
  登录时即可在后台进行此步骤

第三步：选择起始方式
  [导入第一篇文档]
  [先体验演示知识库]

完成 → 进入主界面
```

---

## 二十、隐私与内容安全

### 20.1 Gemini 敏感内容提示

政治敏感内容（帝国主义批判、极左派文本等）上传至 Google 服务器时，应在 UI 中显示提示，或自动降级到其他服务商或本地模型。

```python
def select_provider_for_content(text: str) -> str:
    if is_politically_sensitive(text) and not user_consented_to_google:
        return "groq"   # 逾过 Gemini
    return "gemini"   # 默认最快
```

隐私模式开关：
- **标准模式**：优先免费联网 API
- **混合模式**：敏感任务本地，一般任务联网（推荐）
- **完全本地**：全程 Ollama，需要本地模型

### 20.2 Skill 文件安全

Skill 文件内容会直接插入系统 Prompt。入库前对 Skill 文件做基本注入检测，拦截常见的 Prompt 注入关键词（如 "ignore previous instructions"）。

---

## 二十一、遗漏功能版本规划

| 类别 | 功能 | 版本 |
|------|------|------|
| 核心 | ParsedArgument 结构化解析 | V1.0 |
| 核心 | 流式输出（streaming） | V1.0 |
| 核心 | 文档完整性：嵌入版本绑定 + 级联删除 + 入库断点恢复 | V1.0 |
| 核心 | 预置 Skill 包（5 立场 + 5 入库） | V1.0 |
| 核心 | 新手引导流程 + 演示知识库 | V1.0 |
| 核心 | Gemini 敏感内容隐私提示 | V1.0 |
| 体验 | 反驳质量评分 + 反馈闭环 | V1.1 |
| 体验 | 辩论历史记录 | V1.1 |
| 体验 | 换角度重试按钮 | V1.1 |
| 体验 | 备稿本 + 导出（Word/PDF） | V1.1 |
| 体验 | API 用量仪表板 | V1.1 |
| 体验 | 代理/网络设置 | V1.1 |
| 体验 | 批量导入 + 队列管理 | V1.1 |
| 质量 | counter_targets 规范化词表 | V1.1 |
| 质量 | 入库文档质量评分 | V1.1 |
| 质量 | 同立场内矛盾检测 | V2.0 |
| 质量 | 多轮辩论推演 | V2.0 |
| 引用 | 引用格式选择（APA/MLA/Chicago/GB） | V1.1 |

---

## 二十二、逻辑闭环确认表

| 主流程 | 状态 | 说明 |
|--------|------|------|
| 文档入库：切割→分析→坐标→向量化→索引 | ✓ 闭合 | 断点恢复已覆盖 |
| 反驳生成：解析→检索→排序→生成→格式化 | ✓ 闭合 | ParsedArgument 已补充 |
| 搜索查看：多模式检索→展示→查看原文 | ✓ 闭合 | 内置 PDF.js 已覆盖 |
| 模型路由：多服务商→自动降级→本地兑底 | ✓ 闭合 | 敏感内容降级已覆盖 |
| 云端备份：LanceDB S3 + Litestream SQLite | ✓ 闭合 | 分享知识库包最终方案已设计 |
| 坐标系统：22 轴全量采集→ 3D 立方体可视化→可配置中心点 | ✓ 闭合 | - |
| 上下文限制：分层摘要→按块大小选模型 | ✓ 闭合 | Refine/Map-Reduce 已覆盖 |
| 嵌入模型漂移 | ✓ 闭合 | 版本绑定已补充 |
| 级联删除 | ✓ 闭合 | 已详细列明各层同步 |
| 首次启动体验 | ✓ 闭合 | 新手引导已设计 |
| 敏感内容隐私 | ✓ 闭合 | Gemini 提示和降级已覆盖 |

---

*本文档随项目推进持续更新。*

---

## 二十三、日志与诊断系统

### 23.0 设计原则

1. **日志失败不影响主功能**：所有写入操作静默失败，磁盘满/目录不存在均不抛异常
2. **隐私分级默认最严**：原文内容默认不进日志，调试模式需用户主动开启，关闭软件后自动复位
3. **trace_id 贯穿全链路**：每次顶层操作生成一个 UUID，所有子步骤共享，跨文件关联
4. **Trace-Span 层次结构**：Trace（一次完整操作）下包含多个 Span（子步骤），支持嵌套
5. **异步写入不阻塞**：日志条目进队列，后台批量写入，不影响反驳生成和入库速度
6. **高频操作采样**：retrieval.jsonl 每天最多保留 1000 条，超出用 FIFO 滚动覆盖

### 23.1 隐私分级策略

三档日志详细度，用户在设置中选择：

| 级别 | 记录内容 | 默认 |
|------|---------|------|
| **minimal（最小）** | trace_id、事件类型、耗时、状态码 | ✓ 默认 |
| **standard（标准）** | + 文档 ID、token 数量、立场置信度、查询哈希（SHA-256） | 可选 |
| **debug（调试）** | + 查询原文、Prompt 片段、模型输出片段 | 需明确开启 |

### 23.2 六类日志文件

```
/logs/
  ├── api_calls.jsonl       ← 每次 API 调用的详细记录
  ├── ingestion.jsonl       ← 文档入库流程日志
  ├── retrieval.jsonl       ← 检索与反驳质量日志
  ├── behavior.jsonl        ← 用户行为信号（新增）
  ├── errors.jsonl          ← 所有错误和异常
  └── system.jsonl          ← 启动、资源、健康检查
```

每条日志为单行 JSONL，必含基础字段：

```json
{
  "ts":          "‹ISO 8601 含时区›",
  "trace_id":    "贯穿同一次操作的所有日志",
  "span_id":     "当前子步骤的唯一 ID",
  "parent_span": "父步骤 ID，顶层为 null",
  "level":       "INFO | WARNING | ERROR",
  "component":   "模块名",
  "event":       "动词短语描述发生了什么"
}
```

---

### 23.3 API 调用日志 `api_calls.jsonl`

**收集目的**：监控免费额度使用情况，定位慢请求和失败原因

```json
{
  "trace_id":    "abc-123",
  "span_id":     "span-004",
  "parent_span": "span-001",
  "ts":          "2026-08-17T14:23:01.123Z",
  "event":       "api_call_complete",
  "task":        "chapter_summarize",
  "provider":    "groq",
  "model":       "qwen3-32b",
  "input_tokens":  4821,
  "output_tokens": 183,
  "latency_ms":    1240,
  "status":        "success",
  "doc_id":        "hayek_001",
  "chapter_id":    "chap_03",
  "fallback_from": null
}
```

降级事件示例：
```json
{
  "trace_id":    "abc-456",
  "event":       "api_fallback",
  "task":        "ideology_analysis",
  "fallback_from": "gemini",
  "fallback_to":   "ollama/qwen2.5:14b",
  "reason":        "content_filtered",
  "doc_id":        "marx_capital_v1"
}
```

**请求基线跟踪**：每天将延迟数据统计为 P50/P95，超出 2 倍基线才触发警告，避免假阳性警报。

---

### 23.4 文档入库日志 `ingestion.jsonl`

**收集目的**：追踪入库进度、定位失败原因、分析不准确的文档

Trace-Span 层次展示：
```
Trace: ingest_doc("哈耶克_通往奴役之路.pdf")
  ├─ Span: docling_parse         [102ms]
  ├─ Span: chunking              [48ms]
  ├─ Span: stage3_summarize
  │     ├─ Span: chapter_01        [1,240ms, groq]
  │     ├─ Span: chapter_02        [980ms,  groq]
  │     └─ Span: chapter_03        [1,450ms, groq]
  └─ Span: stage4_ideology       [2,100ms, ollama]
```

章节完成日志：
```json
{
  "trace_id":         "ing-789",
  "span_id":          "span-chap03",
  "parent_span":      "span-stage3",
  "ts":               "2026-08-17T14:00:01Z",
  "event":            "chapter_complete",
  "doc_id":           "hayek_001",
  "chapter_id":       "chap_03",
  "stage":            "summarized",
  "token_used":       5004,
  "detected_stance":  "liberal",
  "stance_confidence": 0.87,
  "chunk_count":      12,
  "duration_ms":      3200
}
```

---

### 23.5 检索与质量日志 `retrieval.jsonl`

**收集目的**：评估 RAG 检索质量，发现知识库相关性问题

新增四个 RAG 质量评分字段：
```json
{
  "trace_id":     "reb-555",
  "span_id":      "span-retrieval",
  "ts":           "2026-08-17T15:10:22Z",
  "event":        "retrieval_complete",
  "stance":       "liberal",
  "style":        "rebuttal",
  "query_hash":   "sha256:a1b2c3...",
  "fts5_hits":    8,
  "vector_hits":  12,
  "final_chunks": 5,
  "top_score":    0.92,
  "retrieval_ms": 340,
  "generation_ms": 2100,
  "quality": {
    "context_relevance":  0.87,
    "chunk_utilization":  0.6,
    "faithfulness":       null,
    "answer_relevance":   null
  }
}
```

**四个 RAG 质量指标说明**：

| 指标 | 含义 | 计算方式 |
|------|------|----------|
| context_relevance | 检索到的块和论点的相关性 | 块嵌入与读读相似度 |
| chunk_utilization | 检索到的块中实际有多少被引用 | 引用块数/检索块数 |
| faithfulness | 生成内容是否忠实于检索结果 | 每个断言是否有来源块支撑 |
| answer_relevance | 最终回答是否回应了原始问题 | 回答嵌入与读读相似度 |

`faithfulness` 和 `answer_relevance` 初始为 null，待 V1.1 引入自动评分柶框时填充。

---

### 23.6 用户行为日志 `behavior.jsonl`

**收集目的**：捕捉隐性质量信号，作为 RAG 系统改进的反馈闭环

```json
{
  "trace_id":   "reb-555",
  "ts":         "2026-08-17T15:12:45Z",
  "event":      "user_action",
  "action":     "retried",
  "reason":     "style_changed",
  "prev_style": "rebuttal",
  "new_style":  "critique",
  "stance":     "liberal"
}
```

`action` 可取值：

| 值 | 含义 | 质量信号 |
|-----|------|----------|
| `copied` | 直接复制了反驳结果 | 正面：结果被采用 |
| `retried_style` | 切换风格重试 | 负面：风格选择不符 |
| `retried_stance` | 切换立场重试 | 负面：立场选择不符 |
| `discarded` | 生成后关闭界面 | 负面：结果没被使用 |
| `saved` | 加入备稿本 | 强正面：结果被保存 |

**特别说明**：行为日志不记录论点原文，只记录操作类型和关联的 trace_id。

---

### 23.7 错误日志 `errors.jsonl`

**收集目的**：所有错误集中展示，方便追查根因

```json
{
  "trace_id":  "err-321",
  "ts":        "2026-08-17T16:22:05Z",
  "level":     "ERROR",
  "component": "lancedb",
  "event":     "vector_search_failed",
  "message":   "Embedding dimension mismatch",
  "context": {
    "expected_dim": 768,
    "actual_dim":   1024,
    "stored_model": "bge-m3-v1.0",
    "current_model":"bge-m3-v1.5"
  },
  "auto_fix":  "prompt_rebuild_index"
}
```

错误日志是所有日志中**唯一永久保留**的类型。

---

### 23.8 系统日志 `system.jsonl`

**收集目的**：启动健康检查、资源使用监控、版本信息

```json
{
  "ts": "2026-08-17T09:00:00Z",
  "event": "startup_check",
  "version": "0.1.0",
  "os": "Windows 11 23H2",
  "memory_mb": 16384,
  "gpu": "NVIDIA RTX 3060 12GB",
  "ollama_running": true,
  "ollama_models": ["qwen2.5:14b", "bge-m3"],
  "bge_m3_status": "loaded",
  "sqlite_version": "3.45.0",
  "lancedb_version": "0.6.1",
  "docling_version": "2.1.0",
  "knowledge_base_docs": 127,
  "knowledge_base_chunks": 18432,
  "knowledge_base_size_mb": 412,
  "vector_store_size_mb": 85,
  "last_ingestion": "2026-08-16T22:10:00Z",
  "last_rebuttal": "2026-08-17T08:55:00Z"
}
```

---

### 23.9 设置页诊断功能：自动健康报告

点击设置页“运行诊断”按钮，自动执行以下检查并生成报告：

```
运行诊断报告（2026-08-17 15:30）
════════════════════════════════

✔ 环境检测
  Python      3.11.8    OK
  Docling     2.1.0     OK
  SQLite      3.45.0    OK
  LanceDB     0.6.1     OK
  BGE-M3      已加载    OK
  Ollama      运行中    OK
    qwen2.5:14b   12.1GB  可用

✔ 知识库状态
  文档总数: 127
  Chunk 总数: 18,432
  嵌入模型版本: bge-m3-v1.5  一致
  FTS5 分词器: jieba  已加载
  索引完整性: 通过 (127/127)

⚠ API 连接检测
  Groq        延迟 340ms   正常
  Gemini      延迟 890ms   正常
  Cerebras    延迟 220ms   正常
  Ollama      延迟 80ms    正常
  OpenRouter  连接超时   ✗ 异常！

⚠ 过去 7 天 RAG 质量趋势
  context_relevance 均值: 0.81  (+0.03 vs 上周)
  chunk_utilization 均值: 0.58  (-0.04 vs 上周)
  检索结果为 0 的查询: 3 次（嵌入斯大林主义立场资料缺乏）
  用户 copied 率: 62%  retried 率: 28%

✗ 发现的问题
  1. [ERROR] OpenRouter 连接超时，请检查网络代理设置
  2. [WARNING] 近 3 天 Groq 配额使用率超过 50%，建议增加 Cerebras 为默认
  3. [WARNING] 12 篇文档坐标置信度 < 0.5，建议重新分析
  4. [INFO] 巅斯大林主义立场检索命中率偏低，建议补充该方向文献

提议操作
  [修复 OpenRouter 设置]  [重建底分文档的坐标]
```

诊断报告不提供导出功能，所有信息仅展示给用户本人。

---

### 23.10 实时配额状态栏

不放在诊断页，而是在**主界面底部状态栏**常驻显示：

```
[状态栏] Groq █████░  58%   Gemini ███░░  56%   Cerebras █░░░░  31%
```

颜色规则：
- **白色**：< 60%，正常
- **黄色**：60–80%，接近上限
- **红色**：> 80%，考虑切换备用服务商

点击状态栏任意一个服务商展开详细信息（今日剩余次数、P50 延迟、近 1 小时内降级次数）。

### 23.11 日志管理策略

| 类型 | 保留周期 | 轮转策略 | 压缩 | 容量上限 |
|------|---------|---------|------|--------|
| api_calls.jsonl | 30 天 | 按天分割 | gzip | 无限制 |
| ingestion.jsonl | 90 天 | 按文档归档 | gzip | 无限制 |
| retrieval.jsonl | 7 天 | FIFO 滚动 | 不压缩 | **1000 条/天** |
| behavior.jsonl | 30 天 | 按天分割 | gzip | 无限制 |
| errors.jsonl | **永久** | 按月分割 | gzip | 无限制 |
| system.jsonl | 365 天 | 按月分割 | gzip | 无限制 |

设置页日志管理分区提供：当前日志整体大小显示、按类型单独清空按钮。

---

### 23.12 诊断功能内置的检查项目清单

| 检查项目 | 判断标准 | 可自动修复 |
|---------|---------|----------|
| Python 环境版本 | ≥ 3.10 | ✗ 需手动 |
| Docling 可用性 | import 成功 | ✗ 需重装 |
| BGE-M3 模型已加载 | 3秒内噪应 | ✓ 自动重载 |
| SQLite FTS5 + jieba 分词 | 测试查询成功 | ✓ 自动重建分词器 |
| LanceDB 向量索引完整性 | chunk 数 = SQLite 的 chunk 数 | ✓ 自动触发重建 |
| 嵌入模型版本一致性 | 模型名匹配 | ✗ 提示用户重建 |
| 各 API 服务商连接状态 | 延迟 < 3秒 | ✓ 自动禁用故障服务商 |
| 免费 API 配额剩余率 | > 20% | ✓ 自动切换备用 |
| Ollama 服务状态 | 进程存活 | ✓ 自动启动 |
| 磁盘剩余空间 | > 2GB | ✗ 提示用户 |
| SQLite 文件完整性 | PRAGMA integrity_check | ✓ 提示修复 |
| 知识库文档计数一致 | SQLite count = LanceDB count | ✓ 自动同步 |
