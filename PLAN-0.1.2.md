# PLAN-0.1.2 · UI 全面重构：双支柱双面布局 + 呼吸感视觉语法

> 版本定位：0.1.2 不加大功能，**重构交互骨架与视觉系统**——把 0.1.1 的
> "8 tab 平铺三栏" 重构为 **双面全屏切换**（知识库面 ⇄ 回应面），
> 建立统一视觉 token（呼吸感 + lieflat 视觉语法），补齐设置页承诺功能
> （自定义服务商/任务链/诊断/主题），合并搜索与溯源，新增逻辑链视图与素材篮。
>
> 设计参照：lieflat-charts 视觉语法（发丝线/大数字/真实单位/单色+受控落点/两种阅读速度）
> + 知识体系可视化平台四截图（树-图-详情三栏联动/关系 chips/学习路线 DAG）。
> 源码路径：`backend/`（引擎）+ `desktop/`（Tauri 前端）
> 参考架构：`ARCH-debate-engine.md` §8.3、`ARCH-UI-reference.md` §〇
> 上版计划：`PLAN-0.1.1.md`

---

## 已确认决策记录

| # | 决策 | 结论 |
|---|------|------|
| 1 | 软件双支柱定位 | ①个人知识数据库（AI 入库/整理/数据化 + 可视化 + 检索）②以库为底的回应引擎（反驳/批判/评价等） |
| 2 | 布局骨架 | **D1 变体：双面全屏切换**——选中面占满整窗，无常驻顶栏开关 |
| 3 | 切换入口 | 右上角常驻悬浮组（可在设置关闭）+ 长按右键滑动手势 + 快捷键 |
| 4 | 快捷键 | 默认 `Ctrl+Tab` 切面、`Ctrl+,` 设置（Alt+Tab 被系统截获不可用）；设置内可自定义（冲突检测） |
| 5 | 手势方向 | 默认**向左滑=去右边的面**（推纸张隐喻）；设置可反转 |
| 6 | 切换动效分层 | 手势=跟手回弹；悬浮钮=200ms 滑动（D4）；快捷键=**瞬切零动画** |
| 7 | 设置形态 | 降级为**全屏覆盖浮层**（Esc 关闭），不参与面切换；入口=悬浮组齿轮副钮 + Ctrl+, |
| 8 | 搜索与溯源 | **合并为知识库面检索区**：一次查询三视角（段落/论点/脉络） |
| 9 | 对比归置 | **B 方案**：库内两文档对比留图景投影；粘贴文本对比挪回应面"分析"意图 |
| 10 | 回应意图一级化 | 反驳/批判/评价/分析/综合报告为一级选择；格式×风格降二级 |
| 11 | 素材篮持久化 | 引擎侧新表（跟库走）；分享包**不含**素材篮 |
| 12 | 快捷键/UI偏好存储 | 前端 localStorage（纯 UI 偏好不进知识库，换机不迁移可接受） |
| 13 | 主题 | 三态：深色/浅色/跟随系统，默认跟随系统；**窗口标题栏随主题**（Tauri setTheme） |
| 14 | 报告导出 HTML | 固定纸感浅色（出版惯例），不跟软件主题；**纯内联 CSS/SVG 禁 CDN**（离线约束） |
| 15 | 可加功能 | 回应存入知识库、图谱节点右键看逻辑链、逻辑链导图嵌报告——**全部立项** |

### 已记录债（本版不做）
- BGE-M3 本地模型管理、新手引导完整流程（本版只做三步导览）、QuotaBar 完整配额条（诊断分区先兑现统计）
- 论证单元向量持久化缓存（沿 0.1.1 债）
- 回应历史跨设备同步；快捷键配置迁移
- URL 批量爬取、登录站点抓取（沿 0.1.1 债）
- ingestion/indexer.py 526 行轻微越线（暂不强拆）

---

## 设计总纲

### 双支柱心智模型
```
支柱一：知识库面                 支柱二：回应面
收集→AI入库/整理/数据化           输入言论→意图（反驳/批判/评价/
→四投影可视化→检索调取            分析/综合报告）→带引用输出
        └────── 素材篮（弹药通道，单向）──────→┘
```

### 呼吸感六原则（全部落入 token 与页面规范）
1. 间距成阶（4/8/12/16/24/40），组内紧组间松；2. 减盒子：明度分区+发丝线，边框只留输入件；
3. 文字节奏：行高 1.6–1.7、字号阶 12/13/15/18/24、长文 72ch；4. 收放对比：大数字+留白为呼、
逐条记录为吸，空状态必须设计；5. 色彩克制：灰阶为底+唯一强调色落点+立场低饱和色板；
6. 动效轻呼吸：150–250ms 过渡、30–50ms stagger、静止零动画。

---

## 版本概述

共 24 个项目，按依赖分 7 批：

| 批 | 项目 | 说明 |
|---|---|---|
| A | 1–6、21、24 | 视觉地基（token/减盒子/排版/页边注/数据元素/空状态）+ 关系集扩展（后端）+ 三态主题 |
| B | 7、8、9 | 双面骨架、命令面板、迁移导览 |
| C | 10、11、12、13 | 知识库面：馆藏/检索三视角/脉络时间轴/图谱联动 |
| D | 14、15 | 逻辑链视图 + 图景对比投影 |
| E | 16–20 | 回应面：意图一级化/Glance/素材篮/历史收藏/存入知识库 |
| F | 22、23 | 报告整页 HTML + 设置页重构 |
| G | — | 全量回归 + 迁移映射验收 + 打包发布 |

---

## 批 A · 视觉地基与数据前提

### 项目1 视觉 token 层
`desktop/src/tokens.css`（新建）+ styles.css 重写消费 token：
- 间距阶 `--sp-1..6`（4/8/12/16/24/40）；字号阶 `--fs-12/13/15/18/24`；行高 1.65
- 明度阶：深浅双色板各 5 档背景 + 4 档文字 + 3 档描边（发丝线=1px 低透明度）
- 色彩：唯一强调色 `--accent`；每立场低饱和主色 `--stance-*`（图谱/树/时间轴共用）
- 动效常量：`--t-fast:160ms` `--t-move:200ms`；stagger 40ms；`prefers-reduced-motion` 尊重
- 布局常量：右栏页边注宽、悬浮组预留区（右上 96px）、断点 1200px（页边注折叠为行内脚注）

### 项目2 减盒子改造
全部面板：容器边框退役→背景明度差一档+发丝线分隔；输入框/下拉保留边框；对照走查 8 个现有面板。

### 项目3 长文排版
输出区/报告正文 `max-width:72ch` 居中；标题上间距>下间距；引用编号小号灰字上标。

### 项目4 页边注右栏
引用/谬误详情改 marginalia 形态：无边框、发丝线左分隔、小字号；一键整栏收起（进入纯写作态）。

### 项目5 lieflat 数据元素
- 大数字统计头组件 `StatHead`（库统计/报告头/检索命中数）
- 可数刻度条 `TickBar`（质量度量：一格=0.1，替代裸小数）
- 账本导轨列表 `LedgerList`（引用列表/文档列表：左导轨对齐+逐条发丝线）
- 列表进场 stagger 40ms（一次性，滚动不重播）

### 项目6 空状态设计规范
每个面/视图空态组件 `EmptyState`：一句引导+一个示例动作按钮（如反驳空态="试试：市场经济已经失败了"一键填入）；全软件禁止裸灰字空态。

### 项目21 关系集扩展（后端，四处联动）
- relation 枚举 +`evolve`（演进）/`analogy`（类比）/`oppose`（同题对立）
- 同步四处：`api/analysis.py` UnitPatch 校验正则；`engine/alignment.py` classify_pair prompt+离线规则（同题对立可由否定词规则判，离线可写）；前端图例；chips 色表
- 旧数据向后兼容（仅新增枚举值）；`/api/analysis/trace` 增加 `stance`、`year_from/year_to` 筛选参数

### 项目24 三态主题系统
- `tokens.css` 双色板 `[data-theme=dark|light]`；浅色=纸感（纸灰+炭黑）
- Tauri：`tauri.conf.json` 窗口 theme 初始值防首帧白闪；运行时 `Window.setTheme(dark|light|null)`——**标题栏随主题**；跟随系统=setTheme(null)+`onThemeChanged` 监听同步 data-theme
- 硬编码色清理：GraphPanel 画布背景/STANCE_COLORS、时间轴画布、chips 色表→全部取 token
- 悬浮组透明度浅色底对比度校验；报告导出 HTML 固定纸感浅色
- 验收红线：深色下窗口标题栏为深色（截图）；启动首帧无白闪

---

## 批 B · 双面骨架

### 项目7 双面全屏切换
`App.tsx` 壳层重写：
- 两面 `<Face id="library">` `<Face id="respond">` 常驻挂载（隐藏面 `visibility:hidden`+translate 位移；重组件懒挂载：首次进入才 mount）；隐藏面暂停重渲染（图谱 active 机制推广）
- 悬浮组（右上，垂直两钮）：主钮=切面（静止 40% 透明度悬停实色；图标显示**对面**图标；素材篮角标；tooltip 含快捷键）；副钮=设置齿轮（小一号更淡）
- 手势：window 捕获阶段监听右键 mousedown→mousemove 累计横向位移；<10px 释放=放行右键菜单；≥10px 进入手势态（抑制 contextmenu）跟手位移预览；≥120px 松手完成切换否则回弹；方向默认向左滑=去右面，设置可反转
- 快捷键：keydown 拦截 Ctrl+Tab（瞬切无动画）/Ctrl+,（设置浮层）；自定义存 localStorage；录制器含系统保留键冲突检测（Alt+Tab、Win+* 拒绝）
- 设置浮层：全屏 overlay（Esc/点外关闭），不卸载底下面
- 窗口标题后缀随面变化（"— 知识库"/"— 回应"）

### 项目8 命令面板（Ctrl+K）
四类命令：切面/全局搜索（回车跳检索区带词）/打开设置/发起回应（带参切面填入输入框）；永不可关闭；悬浮组关闭确认提示中告知 Ctrl+K/Ctrl+Tab/Ctrl+,。

### 项目9 迁移导览
首启三步气泡（知识库面→悬浮钮→回应面），localStorage 记已读；PLAN 验收附映射表：

| 0.1.1 tab | 0.1.2 新家 |
|---|---|
| 反驳 | 回应面（意图=反驳） |
| 搜索 | 知识库面·检索区（段落视角） |
| 导入 | 知识库面·馆藏（拖放+确认条） |
| 对比 | 图景对比投影（库内）/回应面"分析"意图（粘贴文本） |
| 图谱 | 知识库面·图景（图谱投影） |
| 报告 | 回应面（意图=综合报告） |
| 溯源 | 知识库面·检索区（论点+脉络视角） |
| 设置 | 覆盖浮层（齿轮/Ctrl+,） |

---

## 批 C · 知识库面装配

面骨架：顶部全局检索框常驻 + 左立场树/维度筛选 + 中画布（列表/图谱/逻辑链/脉络四投影切换）+ 右档案卡。三方联动：树点选→画布聚焦+档案卡；检索命中→落对应投影；画布点选→树定位+档案卡。

### 项目10 馆藏
- 全窗口拖放导入→**确认条**（文件名+立场选择+确认/取消，不无声入库，立场人工确认红线沿用）；URL 粘贴同入口
- 文档列表（LedgerList 形态）+ 行内导入进度条 + 右下进度气泡
- 档案卡：AI 数据化全景（分块数/提取论证单元数/坐标显著轴/导入时间/内容哈希状态）；右键菜单沿 0.1.1（改立场/作为回应对象/加入素材篮/删除）

### 项目11 检索区（搜索+溯源合并）
- 一个查询框三视角 tab：**段落**（现 /api/search，关键词高亮）/**论点**（/api/analysis/trace chain）/**脉络**（同数据时间轴渲染）
- 前端并行调两端点，不建聚合端点；筛选栏（立场/年代区间/来源定位词）两路同时生效（用批 A trace 新参数）
- 结果动作：查看原文/图谱聚焦（切图谱投影并聚焦）/加入素材篮；**多选批量加篮**
- Ctrl+K 全局搜索落到此处

### 项目12 脉络时间轴
- 横向时间轴：X 轴年代（发丝线刻度一线一个十年）+ 泳道=流派或立场 + 节点=论证单元 + 边=演进(实线)/攻击(红) + **模型推测=虚线框异色**
- 年份 join documents.year（无新字段）；年代缺失节点归"年代不详"泳道尾部
- SVG 自绘（数据量可控，不引新库）

### 项目13 图谱三栏联动
- 聚焦模式=邻域子图渲染（非全图降透明度，保性能）；点树/检索命中/点节点三向联动
- 关系 chips 过滤条：全部/支持/攻击/细化/演进/类比/同题对立，带计数带 token 色，多选
- 渐进展开：默认只渲染枢纽度 top-N+邻域，"展开更多"分级加载
- 论点档案卡：原文/出处/思想家/年代/**枢纽度**（度中心性）/**争议度**（攻击边占比）/**证据强度**（关联 chunk 数）/编辑删除（沿 0.1.1 纠错）
- 底部状态栏：焦点节点+面包屑+节点/边计数

---

## 批 D · 逻辑链与图景收尾

### 项目14 逻辑链视图
- 后端 `engine/alignment.py` 增 `logic_chain(anchor_type, anchor_id/query)`：以论题/立场/思想家为锚，沿 evolve/attack/support 边按年代与关系强度提取主线路径（图上加权最长路径，截断 12 节点）；`api/analysis.py` 增 GET /api/analysis/chain
- 前端：横向链画布（节点卡片+边标签），锚点选择器；**离线/无边引导**：边不足时提示"点击生成关系边（需模型 Key）"复用 relations/build
- 图谱节点右键菜单+「查看此论点的逻辑链」（入口糖）

### 项目15 图景对比投影
- 画布第五投影"对比"：库内两文档选择→分歧表（复用 compare_docs）+ 矩阵视图（立场×论题热力格，聚合 arg_units 关系统计）
- 粘贴文本对比从此处移除（迁回应面项目16）

---

## 批 E · 回应面全量

面骨架：左=素材篮+历史收藏 / 中=输入→意图→输出（Glance）/ 右=页边注（项目4）。

### 项目16 回应意图一级化
- 一级意图选择：**反驳/批判/评价/分析/综合报告**；格式×风格收入"高级选项"折叠区
- 反驳/批判/评价：走 /api/rebut 增 `intent` 参数；skills 增 `intents.md`（各意图 prompt 分支：批判=攻击论证结构与前提、评价=多立场利弊+不下唯一裁决）；离线模板同步分支
- 分析=粘贴双文本对比（复用 compare_texts，UI 迁入）
- 综合报告：前端路由到 /api/analysis/report（预估→确认→生成流程沿 0.1.1）

### 项目17 回应面 Glance 化
要点先行（生成完成后提取首段要点大字显示，展开全文）；唯一强调色只给生成按钮/我方核心主张/当前意图；控件三组分区（立场定位/输出形态/检索行为）组内紧组间松。

### 项目18 素材篮
- 引擎侧新表 `basket(id, type[chunk|arg_unit|document], ref_id, excerpt, added_at)` + CRUD 端点；分享包白名单**不含**
- 前端：篮面板（左栏顶部）、全软件"加入素材篮"动作（检索结果/图谱节点/文档右键/时间轴节点）、悬浮组角标联动
- 生成注入：/api/rebut 增 `material_ids`，检索链把篮内条目作为强制引用候选置顶；容量上限 20，注入超 token 预算时截断+提示
- 回应引用后条目标记"已使用"

### 项目19 回应历史与收藏
- 引擎侧新表 `responses(id, intent, input_text, output_text, citations_json, provider, created_at, starred)` + CRUD；报告历史同表（intent=report，正文存路径：knowledge_base/reports/）
- 左栏历史列表（LedgerList）：点击回填输入与输出；收藏置顶；删除
- 生成完成自动入表（离线生成也记录）

### 项目20 回应存入知识库
输出区"存入知识库"按钮→以标准化 .md 入库（来源标注"自产回应"，stance=生成时立场，走正常导入管线含确认条）；自产文档在树中带角标。

---

## 批 F · 报告与设置

### 项目22 报告整页 HTML
- 引擎 `engine/report.py` 增 HTML 渲染：lieflat 纸感模板（大数字统计头/立场对比矩阵/证据引用旁注/来源页脚/共识区色块）；**纯内联 CSS+SVG，零 CDN**
- 逻辑链可选嵌入（SVG 直出）；WebView 预览 + save-text 导出 .html；Markdown 导出保留

### 项目23 设置页重构（覆盖浮层内，左导航六分区）
- **A 模型服务商**：任务分工总览表（5 任务×当前生效链，实时标注落点；全空=离线兜底提示）；服务商卡片加"承担任务"标签（TASK_CHAINS 反查+优先级序号）+免费额度小字+连通测试按钮；Ollama 未检测给 `ollama serve` 指导；**自定义服务商**：名称/BaseURL/Key/模型名（/v1/models 自动拉取或手填）→ 加入任务链；后端：`storage` 增 settings.json 加载层（config 静态值为默认，settings.json 覆盖）、providers CRUD 端点、通用 OpenAICompatProvider、router 写入后热重建
- **B 生成与检索参数**：Top-K/引用密度默认档/温度（写 settings.json 热生效）
- **C 知识库**：分享/备份（沿 0.1.1）+数据目录+统计大数字（StatHead）
- **D 知识文件**：说明+「打开 skills 目录」按钮
- **E 诊断与日志**：health 检查项/最近错误/API 调用与降级统计（消费 diagnostics 端点）
- **F 界面**：主题三选（深/浅/跟随系统）/悬浮组开关（关闭时确认提示快捷键）/手势开关与方向反转/快捷键自定义（录制+冲突检测）/快捷键表常驻显示

---

## 批 G · 回归与发布

- 三处右键菜单回归（树/图谱节点/文档列表不受手势影响）
- 离线模式全功能走查：逻辑链/chips/relations 引导提示到位；回应五意图离线降级正常
- 迁移映射表逐项可达性验收（项目9 表）
- 双主题全页面走查（含标题栏截图、首帧无白闪）
- 行数扫描 + PLAN 台账收口 + NSIS 重打包 + 安装实测（零 cmd 红线沿用）+ GitHub push + Release

---

## 验收红线汇总

1. 全程零 cmd 窗口（沿 0.1.1）
2. 深色模式窗口标题栏为深色；启动首帧无白闪
3. 右键菜单三处不受手势影响；手势 <120px 回弹不切换
4. 悬浮组关闭后 Ctrl+K/Ctrl+,/Ctrl+Tab 仍可用且有提示（无迷路死锁）
5. 报告 HTML 断网可完整打开（零 CDN）
6. 素材篮/回应历史不进分享包；隐私红线复验（logs/.env/Key 零泄漏）
7. 离线模式所有依赖模型的功能有明确引导而非静默失败
8. 0.1.1 旧库直接打开无迁移错误（新表自动建，枚举兼容）

---

## 改动台账

### 批 A+E+F 后端（一次收口，pytest 64 绿）
- `storage/sqlite_store.py`：+basket/responses 两表（IF NOT EXISTS，旧库兼容）+ 篮 CRUD（上限20、UNIQUE 去重、mark_used）+ 历史 CRUD（收藏置顶）
- `engine/alignment.py`：RELATIONS 六类常量；prompt/校验/写回/图谱/分歧全部扩枚举；离线规则否定词不对称→判 oppose（可离线写边）；trace +stance/year 筛选；+logic_chain（种子对齐→BFS 连通→年代升序，无边给引导 hint）
- `api/analysis.py`：UnitPatch 六关系正则；trace 请求体扩参；+GET /api/analysis/chain
- `engine/rebuttal_engine.py`：INTENTS（rebut/critique/evaluate prompt 分支，内置常量未走 skills 文件——记债）；build_prompt +intent；素材篮条目置顶统一重编号 C1..（must_use ★标注）；结果 +intent
- `api/rebuttal.py`：+intent/material_ids 校验；流式/同步完成后 _record 写回应历史 + basket_mark_used（失败不阻断）
- `api/workspace.py`（新）：/api/basket CRUD + /api/responses CRUD；main.py 挂载
- `engine/report.py`：+render_html（纸感浅色单文件、零 CDN、最小 md→html、大数字统计头、来源页脚）；generate 返回 +report_html
- `config.py`：settings.json 覆盖层（load/save/apply + effective_custom_providers/effective_task_chains）；VERSION 0.1.2
- `models/llm_client.py`：build_providers 改读 effective_custom_providers
- `models/model_router.py`：_chain 走 effective_task_chains（热生效）
- `api/settings.py`：+GET /config/tasks（任务分工总览+落点）、自定义服务商 CRUD（插链首+reset_router）、GET/PATCH /config/params、POST /config/test/{provider}
- `tests/test_workspace.py`（新 7 测试）；test_alignment 离线断言改 oppose

### 批 A-F 前端（tsc + vite 构建绿）
- `tokens.css`（新）：间距/字号/动效/布局常量 + 深浅双色板（data-theme）+ prefers-reduced-motion
- `theme.ts`（新）：三态主题，Window.setTheme 驱动标题栏 + onThemeChanged 跟随系统
- `tauri.conf.json`：version 0.1.2、初始 theme Dark + backgroundColor 防白闪、标题「知识库」
- `App.tsx` 重写：双面骨架（faces 平移容器/瞬切 no-anim/手势跟手位移回弹 ≥120px、<10px 放行右键）、悬浮组（40% 透明+角标+齿轮）、快捷键（localStorage 自定义）、命令面板（切面/搜索/回应/设置）、设置覆盖浮层、三步导览、跨面通道（respondWith/searchWith）
- `faces/LibraryFace.tsx`（新）：顶部检索（段落+论点双路并发/era 视角）、筛选栏（立场/年代双路生效）、立场树+统计头、五投影（馆藏/图谱/逻辑链/脉络/对比）、档案卡、右键菜单（+加入素材篮/查看逻辑链）
- `faces/RespondFace.tsx`（新）：素材篮（勾选注入/已使用态）、回应历史（收藏置顶/回填/删除/存入知识库=save-text→import→confirm）、五意图一级化、页边注右栏
- `views/ChainView.tsx`（新）：锚点→主线横向卡片链+关系 chip+空态引导
- `views/TimelineView.tsx`（新）：SVG 年代泳道（十年发丝刻度/立场泳道/年代不详尾巷），双模式（检索脉络视角/全库投影）
- `panels/RebutPanel.tsx`：+intent/materialIds/onDone props；Glance 要点先行（完成后首段大字）
- `panels/GraphPanel.tsx`：颜色全取 token（cssVar）；六关系 chips 过滤条；节点右键+「查看此论点的逻辑链」
- `panels/ComparePanel.tsx`：+initialMode；REL_LABEL 扩六关系
- `panels/SettingsPanel.tsx` 重写：六分区左导航（A 任务总览表+内置卡片带承担任务/连通测试+自定义服务商 CRUD；B 参数热生效；C 统计大数字+分享备份；D 知识文件；E 诊断（可用性+落点）；F 主题三选/悬浮组/手势方向/快捷键下拉+系统保留键拒绝）
- `styles.css` 重写：全量 token 化（发丝线代边框/账本 stagger/空态组件/chips/时间轴/逻辑链/双面/悬浮组/浮层）
- `api.ts`：RebutRequest +intent/material_ids

### 记录差异（vs 计划）
- intents 用内置常量未走 skills/intents.md（用户不可改意图方法论——降债）
- 渐进展开（图谱 top-N 分级加载）未做——节点量级尚小，记债
- 拖放导入确认条沿用 ImportPanel 既有预览确认流（等价满足「不无声入库」红线）
