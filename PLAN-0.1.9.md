# PLAN-0.1.9

> 版本主题：年份数据健全、立方图回归修复、关系边增量更新、馆藏文件夹化布局改版、设置页表单规范化。
> 收集期：2026-08-23（四阶段完成：逐项代码证据核实、联动/副作用矩阵、换位评审补 3 项、联网参考 GraphRAG 增量索引 / Zotero collections / beeswarm 布局 / VS Code 设置页）。
> 纪律：批边界三件事（编译/复读 diff/台账）+ 红线回对 + 漂移自检。每项四段：证据/规格/红线/联动。

## 〇、拍板记录（全部已定，实施不再询问）

| 决策点 | 拍板 |
|---|---|
| 关系边更新形态 | **B：双按钮**「更新新增」/「全量重建」；记账由系统自动（relations_at），用户无需记忆；全量重建**二次确认** |
| 增量配对语义 | 新增文档论证单元 × **全库**单元交叉配对（新×旧+新×新），非圈内互配 |
| 立方图修复基准 | 以 cube-demo.html（0.1.6 演示）为视觉基准原样移植大立方；撤销 0.1.8 V2 的 R=0.22 误修 |
| 脉络密集布局 | 泳道内 **beeswarm 蜂群排布**（有/无年份共用同一算法） |
| 年份存量迁移 | `manual_fields` 含 year 的文档**跳过**（手动最高优先）；解析失败置 NULL 不留脏数 |
| 「日常」风格落地 | 代码内置兜底 + skill 模板双轨；升级走 skill 缺项补齐迁移 |
| 文件夹视图归属 | 文档只按**主立场**归文件夹；次立场仅详情列显示，不多处出现 |
| 生成历史多轮化 | **移出本版**，0.1.10 主项 |
| 设置页扫描范围 | 整页所有 section 统一规范（用户未反对方案 4 默认整页） |

## 一、项目清单（15 条，覆盖收集期 22 项中的 21 项，原 10 移出；每项四段）

### 族 D · 数据健全（批 1，零依赖先行）

**D1（原 8）年份全链路：紧凑时间戳解析 + sane_year 收口 + 存量迁移 + year_raw 回显**
- 证据：parsers.py L80 `int(meta["year"]) if str(...).isdigit()` 是唯一外源写点，14 位时间戳 `20260501120137` 通过 isdigit 入库；dates.ts 格式表无紧凑格式；用户原文实为「2026-05-01 12:01:37」被导出工具压缩。
- 规格：① backend 新增 `sane_year(v) -> int|None`（识别 4 位年、YYYY-MM-DD[ HH:MM:SS]、紧凑 8/12/14 位并逐段验月日时分秒合法，超 -3000..2600 或非法→None），parsers.py/web-enrich/knowledge.py PATCH 三写点统一走它（PATCH 现有 422 校验改为调用共用函数）；② 同时保存 `year_raw` 原文（已有字段则复用）；③ 一次性存量迁移（版本迁移钩子）：year 超范围的文档从 raw_metadata/year_raw 重解析，manual_fields 含 year 跳过，失败置 NULL；④ dates.ts 格式表补紧凑格式（与后端同表同语义）；⑤ 档案卡年份行显示归一化 year_raw（如 `2026-05-01 12:01:37`），筛选/脉络/排序仍用 year 整数；⑥ MetadataDialog 年份框接受完整日期输入（解析出 year+year_raw 双存），提示文案更新。
- 红线：`20260501120137` 导入后 year=2026、卡片显示 `2026-05-01 12:01:37`；手动改过年份的文档迁移后不变；py_compile+tsc 0 错。
- 联动：D1 修好后 V3 无年份兜底触发率大降；TimelineView saneYear 显示层夹钳保留为最后防线。

**D2（原 16+20）档案视图立场 label 映射 + 定位说明**
- 证据：ArchiveView.tsx L59 直接渲染 `{s.stance}`（物理目录名 marxist）；组件无 stances 数据源；馆藏/档案两处"按立场看文件"用户已混淆。
- 规格：App 传 stances 入 ArchiveView，显示层 `stanceLabel` 映射，悬停 title 显示内部名（对照磁盘文件夹）；物理目录名不动；头部说明文案改「档案库 = 磁盘上的人可读备份（md + 原件），与馆藏文档一一对应」。
- 红线：档案树显示「马列毛主义立场」；磁盘目录仍为 marxist；刷新后正常。
- 联动：与 L1 文件夹视图的立场名同源（G5 stanceLabel）。

**D3（原 15）SVG 文字误用 HTML 类全局修复**
- 证据：RadarView L87 SVG `<text className="muted small">`，SVG 不吃 `color` 只吃 `fill`→深色底近黑不可见（用户雷达图两次反馈）。
- 规格：styles.css 新增 `.viz-cap { fill: var(--tx-3); font-size: 11px; }`；全局 grep `desktop/src` 内 SVG `<text>` 挂 muted/small 的位置（Radar/Scatter/Timeline/Chain/Cube 全查）统一换类。
- 红线：雷达图顶部说明行深色下清晰可读；grep 复查 SVG 内无残留 muted/small。
- 联动：V1/V3 新绘制文字直接用 .viz-cap。

### 族 V · 可视化（批 2）

**V1（原 13+12）立方图恢复大立方 + 中心切换双 bug + 尺寸撤回 + 全零横幅核查**
- 证据：CubeView draw() 无任何大立方绘制段（0.1.7 项 6 重写时丢失）——demo 有六面渐变场/内壁方格/线框/0 点虚线/轴端标注，当前全缺；L124-126 中心偏移读边算边填的 stanceMetas（时序错误，先算的立场减不到偏移）；文档点 rows 未应用偏移（点框错位）；L98 R=0.22 为对残缺画面的误修（大立方恢复后会溢出 2 倍）；L348 全零横幅代码在但用户全零库未显示。
- 规格：① 从 cube-demo.html 原样移植 drawCube（FACES 远→近排序渐变填充、面向视角三内壁方格、线框、三轴 0 点虚线、轴端 neg/pos 语义标注 axes.ts），颜色适配深色 token（线框/方格/标注用 cssVar）；② R 撤回 `min(W,H)*0.062`（微调上限 0.075），zoom 上限 4 保留；③ 中心切换两遍算法：先算全部立场 rawCen → 取 centerStance 均值 → 统一减偏移，**文档点、距离虚线、hover 命中表同一偏移源**；大立方边界与轴端标注保持 ±5 不动，虚线十字标新原点；④ 排查全零横幅未显示根因（docs 数据源/条件短路）并修复。
- 红线：对照 0.1.6 演示截图：大立方撑满画布约 8 成、色场/方格/轴端标注齐全；中心切换后点在框内不错位；全零库显示引导横幅；tsc 0 错。
- 联动：D3 的 .viz-cap 用于轴端标注；透明度偏好 de.cube.alpha 语义不变（作用于渐变场）。

**V3（原 17）脉络泳道 beeswarm 布局**
- 证据：TimelineView L93-94 无年份兜底 `(i % 12) * 52` 固定 12 列，84 节点堆叠 12 列×72px 泳道带，标签糊死、右半画布全空、下方大片空白。
- 规格：① 泳道内 beeswarm：x=年份定位（无年份=按导入序均布全可用宽），y 在泳道内贪心避让（圆堆叠、聚而不叠）；② 泳道高度按内容自适应（不再固定 LANE_H），画布总高=Σ泳道实际高；③ 密度感知：单泳道节点 >20 时关闭常显标签仅 hover 显示，顶部提示「节点较多，悬停查看标题」；④ 有/无年份共用同一算法（有年份 x 锁定，无年份 x 自由）。
- 红线：84 节点无年份时铺满画布宽、无叠字、无下方大空白；D1 迁移后有年份文档回到时间轴定位。
- 联动：D1 先行减少无年份场景；saneYear 夹钳保留。

### 族 E · 关系边（批 3）

**E1（原 11）增量更新双按钮 + relations_at 记账 + 交叉配对**
- 证据：GraphPanel「生成/更新关系边」调 POST /api/relations/build 不传参→全库重配重判（analysis.py L50-53）；alignment.py build_relations L169-170 doc_ids 语义为圈内互配（新只连新，漏新×旧）；库内无已配对记账。参考 GraphRAG v0.4.0 update 命令（仅新文档抽取合并）。
- 规格：① documents 表加 `relations_at` 时间戳（迁移加列，配对完成时打标）；② build_relations 加 `mode` 参数：`incremental`=relations_at 为 NULL 的文档 units × 全库 units 交叉配对（`pair_units(new_units, all_units)`），已有关系边不动；`full`=清全部边重配（现行为）；③ 前端双按钮：「更新新增（N）」N=待更新文档数（0 时禁用+title 提示）；「全量重建」→ askConfirm danger「将清空全部关系边并对全库 N 个论证单元重新配对判定，耗时较长，确定？」；④ 记账失效三联动：reextract 清边时置空 relations_at；M5 删除级联天然清理；M6 合并新 doc relations_at=NULL。
- 红线：新导入 1 篇后「更新新增（1）」只跑该篇×全库且新旧之间产生边；全量必经确认；重提取后按钮 N=全库数。
- 联动：与 E2 同一确认+内联进度规格；BgTask 断线续看范式复用。

**E2（原 7）重新提取坐标二次确认**
- 证据：ReextractButton.tsx L18-33 run() 点击即启全库任务，无确认。
- 规格：run() 前 askConfirm danger：「将对全库 N 本重跑章节摘要与 22 轴坐标（清空现有关系边），耗时较长，确定？」；确认后行为不变（内联进度+断点续做）。
- 红线：误点一次不再直接开跑；取消无副作用。
- 联动：与 E1 全量重建同文案规格；L3 角标点击路径也经此确认。

### 族 L · 馆藏布局改版（批 4，先拆后补）

**L1（原 1+3）立场文件夹两级导航 + 删除左树 + 清 M1 死码**
- 证据：现状左 DocTree + 中 DocExplorer 平铺全库；0.1.8 M1 的 treeStance→explorerDocs 过滤链路将随树删除成死码。
- 规格：① DocExplorer 根层=立场文件夹（行/卡：stanceLabel + 篇数 + 待审数徽章 + 未分类文件夹），点入二层=该立场文档列表，面包屑「馆藏 › 立场名」可点返回；② 三视图（图标/列表/详细）与排序仅作用于文档层，根层固定按立场名排；③ 删除 DocTree.tsx 及 App 布局引用，清 treeStance/M1 过滤死码；④ 多选/框选/合并限当前文件夹内。
- 红线：tsc 0 错且无未引用文件；文件夹篇数=库内实数；进出文件夹视图/排序偏好不丢（lib.view/lib.sort 沿用）。
- 联动：L2 靠删树腾出左栏；D2 立场名同源；R4 次立场仅详情列。

**L2（原 2）导入区移左栏 + 确认屏弹窗化**
- 证据：导入现占中区；删树后左栏空置；导入预览/归档三选确认屏原设计依赖中区大空间，左栏 280px 放不下。
- 规格：① ImportPanel 紧凑纵排入左栏：拖放热区（Tauri onDragDrop 高亮指向左栏）、URL 输入、重复处置、摘要策略、进度内联；② 解析预览/元数据补全/归档三选确认屏改为**居中弹窗**（dialog-card 范式）；③ 中区全宽让给文件窗口。
- 红线：拖文件到窗口任意处仍能入队；确认弹窗 Esc/遮罩关闭不丢已解析结果；一次导入多文件逐个确认流程不变。
- 联动：依赖 L1 先落；L3 工具条不再放导入入口。

**L3（原 4+14）中区工具条重排 + 过滤集成 + 待提取角标**
- 证据：左栏过滤框（标题/作者/拼音首字）随树删除需迁移；工具条现有重提取/视图/排序，再加面包屑+过滤+角标会拥挤；坐标提取失败现状静默填 0（用户 17 本全零自己发现）。
- 规格：① 工具条两行：行 1=面包屑 + 过滤框（原左栏逻辑原样迁移，全局「检索知识库」顶栏不动）；行 2=操作组（重提取按钮+角标、三视图切换、排序、升降序）；② 黄色角标「N 本待提取坐标」（isSuspiciousZero 统计），点击→E2 确认流程，清零消失；③ 导入完成通知点名失败：「入库 N 本；坐标提取失败 M 本（模型未运行），可稍后在馆藏工具条重新提取」。
- 红线：过滤在文件夹层过滤文件夹、文档层过滤文档；角标数=全零文档实数且提取完成后消失；两行工具条不换行溢出。
- 联动：依赖 L1/L2 先落；角标点击复用 E2 确认。

**L4（原 6）右栏溢出修复 + 原始数据区标注折叠**
- 证据：styles.css L244-245 `.lib-right` 无 overflow-y（文字溢出区域，用户截图证实）；右下 front-matter 原文与右上档案卡无视觉分界，用户分不清两者区别。
- 规格：① `.lib-right` 加 `overflow-y:auto; min-height:0;`，内文 `word-break:break-word`；② 右下原始数据区加折叠小节头「原始数据（导入原文，供核对）」默认折叠，展开记忆（uiPrefs）；③ 右上档案卡不动（解析后结构化视图）。
- 红线：长 front-matter 不再溢出；折叠态刷新后保持；档案卡与原始数据肉眼可分。
- 联动：D1 的 year_raw 显示落在档案卡年份行。

### 族 R · 回应面（批 5）

**R1（原 9+22）「日常」风格/格式 + skill 缺项补齐迁移**
- 证据：风格列表来自 skills/styles.md（NSIS SetOverwrite off 不覆盖用户版）→ 老用户升级无新风格；FORMATS 为前端代码常量；无立场（none）已在 0.1.8 修复可选。
- 规格：① 后端 `_BUILTIN_STYLES` 兜底加 `daily 日常`（口语、短句、无术语堆砌），skills/styles.md 模板同步；② FORMATS 加 `plain 日常`（自然段随笔，无固定结构）；③ 通用 skill 迁移器：启动时对照内置模板，用户 skill **缺该小节则追加、已有小节不动**（含 17 轴合并表等历史新增），迁移日志入 backend 日志；④ 升级场景验证：模拟旧 styles.md 启动后出现 daily 且用户自定义行原样。
- 红线：新装与升级用户风格/格式列表都含「日常」；用户改过的风格行不被覆盖。
- 联动：R3（none 立场）+ daily 组合冒烟一次；迁移器为今后所有 skill 新增项的共用通道。

**R2（原 18）素材组组头右键删除**
- 证据：RespondFace L242-253 组头内联「全选/改/×」，× 紧邻「改」易误触（有确认但入口太浅）。
- 规格：组头删「改」「×」按钮，保留「全选」；组头 onContextMenu → OverlayMenu：「整组注入 / 改名… / 删除组…(danger)」；删除保留现有 askConfirm 与"素材并入公共素材组"语义；公共组（pinned）右键仅「整组注入」。
- 红线：组头无 × 按钮；右键菜单三项可用；素材条目右键菜单不受影响。
- 联动：OverlayMenu 复用（G1 共用件）；与 G3 全局右键经 defaultPrevented 让行。

**R3（原 21）次立场详情列显示**
- 证据：documents.secondary_stances 字段已存在但馆藏详情视图未显示，文件夹化后用户会疑惑"标了两个立场只在一个文件夹"。
- 规格：DocExplorer 详细信息视图加「次立场」列（stanceLabel 映射、逗号分隔、空则 —）；档案卡补同名行。
- 红线：无次立场文档显示 —；列宽不挤压标题列。
- 联动：L1 文件夹只按主立场归位的补偿说明。

### 族 S · 设置页（批 5）

**S1（原 19）设置页表单规范化**
- 证据：生成与检索参数三个数字框宽度各异不对齐、行距松散无单位；归档三选用原生 radio 与深色组件语言不符（用户两截图）。
- 规格：① 通用 field 行网格 `.set-row { display:grid; grid-template-columns: 1fr 160px; }`：标签左、控件右缘对齐；数字框统一 120px、数字右对齐、后缀灰字单位（条/token）；行高走现有高度阶梯，行距压缩一档；② 归档三选改 SegmentedSlider（值与 settings.json 键不变）；③ 同规范扫全设置页所有 section（字体/模型/数据目录/日志等），一次改齐。
- 红线：全设置页控件右缘成一条线；radio 全部消失；热生效行为不变；tsc 0 错。
- 联动：SegmentedSlider 复用回应面同款；无后端改动。

## 二、批次执行顺序（防返工：共用件先行、风险升序）

| 批 | 项 | 说明 |
|---|---|---|
| 批 1 | D1 D2 D3 | 零依赖数据/显示修复，先行落地 |
| 批 2 | V1 V3 | 可视化重做（依赖 D3 的 .viz-cap） |
| 批 3 | E1 E2 | 关系边+确认（后端迁移加列先行） |
| 批 4 | L1 → L2 → L3 → L4 | 布局改版链（严格顺序：先拆树再移导入再排工具条） |
| 批 5 | R1 R2 R3 S1 | 回应面+设置收尾 |
| 收尾 | 版本号四处同步 0.1.9 → vite/cargo/PyInstaller/NSIS → 冒烟 → 台账 | 含行数扫描与越线处置 |

## 三、验收红线（全局）

1. `npx tsc --noEmit` EXIT=0；`py_compile` 全部改动文件通过；`import main` OK。
2. 立方图对照 0.1.6 演示截图目视回对（大立方/色场/方格/轴端标注/中心切换不错位）。
3. 用户实库场景复验：`20260501120137` → 2026 + 原文回显；17 本全零 → 角标+横幅+确认后重提取。
4. 关系边：增量只跑新文档且产生新旧交叉边；全量必经确认。
5. 升级模拟：旧 skills 目录启动后「日常」出现且用户自定义行不动。
6. 布局改版后全交互路径回归：多选、合并、元数据编辑、审核、删除不回退。
7. 版本收尾行数扫描（对照 Software Architecture.md §2），越线文件上报处置。

## 四、改动台账（实施时逐批追加）

### 已完成（本阶段）
| 项 | 文件/模块 | 改动摘要 |
|---|---|---|
| D1 | backend/lib/years.py | 新建 sane_year() 统一解析器 + parse_iso_date 紧凑格式支持 |
| D1 | backend/ingestion/parsers.py | parse_md/parse_txt 调用 sane_year(),_year_raw 内部标记 |
| D1 | backend/ingestion/confirm.py | upsert_document 写入 year_raw 字段 |
| D1 | desktop/src/lib/dates.ts | FORMATS 增加 14/12/8 位紧凑格式 + inRange 校验 |
| D1 | desktop/src/components/MetadataDialog.tsx | 年份输入接受完整日期 + patch 时双存 year+year_raw |
| D1 | backend/api/knowledge.py | **PATCH 校验改调 sane_year()（共用函数），year_raw 兜底** |
| D1 | backend/storage/sqlite_store.py | **_migrate_years() 一次性存量迁移：超范围年份从 year_raw/原值重解析，manual 跳过，失败置 NULL** |
| D1 | desktop/src/faces/LibraryFace.tsx | 档案卡年份行显示 year_raw 归一化原文 |
| D2 | desktop/src/views/ArchiveView.tsx | stanceLabel 映射 + 头部说明文案 |
| D3 | desktop/src/styles.css + RadarView | .viz-cap fill 修复；SVG text 无残留 muted/small |
| E1 | backend/storage/sqlite_store.py | relations_at 列 + mark_relations_built/count_relations_pending/clear_relations_at |
| E1 | backend/engine/alignment.py | build_relations(mode) 增量/全量 + **两模式打标 relations_at** |
| E1 | backend/api/analysis.py | mode 参数 + **/relations/pending_count 端点** |
| E1 | backend/api/reextract.py | **重提取清边同步 clear_relations_at** |
| E1 | desktop/src/panels/GraphPanel.tsx | **双按钮「更新新增(N)」/「全量重建」+ pending 计数拉取 + 全量确认** |
| E2 | desktop/src/components/ReextractButton.tsx | run() 前置 askConfirm 二次确认 |
| L1 | desktop/src/components/FolderRoot.tsx | 文件夹两级导航（根层立场 → 二层文档），修复语法/CSS |
| L1 | desktop/src/faces/LibraryFace.tsx | **DocTree 删除、FolderRoot 集成、清 explorerDocs/treeStance 死码、修复 mojibake 与 JSX 结构** |
| L2 | desktop/src/faces/LibraryFace.tsx + styles.css | ImportPanel 迁至左栏（lib-split-left）+ 中区五视图 |
| L4 | desktop/src/styles.css | .lib-right overflow-y/auto + word-break |
| L4 | desktop/src/faces/LibraryFace.tsx | **右栏原始数据折叠小节「原始数据（导入原文，供核对）」默认折叠 + localStorage 记忆** |
| V1 | desktop/src/views/viz/CubeView.tsx | **大立方 drawCube 从 cube-demo 移植（六面渐变场/内壁方格/线框/0 点虚线/轴端标注）；R 撤回 0.07；中心切换两遍算法修复（点/立方/命中同偏移源）** |
| V3 | desktop/src/views/TimelineView.tsx | **泳道内 beeswarm 蜂群布局 + 泳道高度自适应 + 密度感知（＞20 关标签仅 hover）+ 有/无年份共用算法** |
| R1 | backend/engine/rebuttal_engine.py + skills/styles.md | daily「日常」风格（内置兜底 + 模板同步） |
| R2 | desktop/src/faces/RespondFace.tsx | 组头移除「改」按钮（减少误触） |
| R3 | desktop/src/components/DocExplorer.tsx | 详细视图新增「次立场」列（stanceLabel 映射，空则 —） |
| S1 | desktop/src/styles.css | .set-row 网格对齐 + 数字框 120px 右对齐 + 单位后缀（CSS 基础） |

### 补丁 (0.1.9-bump)
| 项 | 文件/模块 | 改动摘要 |
|---|---|---|
| L2② | desktop/src/panels/ImportPanel.tsx + styles.css | **确认屏居中弹窗化**（overlay/dialog-card 范式、Esc/遮罩暂收不丢解析结果、左栏续确认） |
| R3② | desktop/src/faces/LibraryFace.tsx | **档案卡补次立场行**（stanceLabel 映射、逗号分隔、空则 —） |
| L3 | LibraryFace.tsx | 工具条两行（面包屑+过滤框 / 操作组）；受控 crumbStance；待提取坐标数拉取 |
| L3 | FolderRoot.tsx | 受控面包屑 + 过滤（根层文件夹名 / 文档层标题·作者） |
| L3 | ReextractButton.tsx | pendingCoords 黄色角标「N 本待提取坐标」，点击走同一 E2 确认 |
| L3 | backend/api/analysis.py | /coords/pending_count 端点（全 0/缺失坐标计数） |
| L3 | ImportPanel.tsx | 批量导入完成点名入库/失败数 + 坐标重提取指引 |
| R1 | backend/storage/skill_migrator.py + main.py | 通用 skill 迁移器（启动补齐缺失 ## 小节，不覆盖用户改动）+ lifespan 挂钩 |
| R1 | backend/engine/rebuttal_engine.py | FORMATS 增加 plain「日常」（自然段随笔） |
| R2 | RespondFace.tsx | 组头 onContextMenu → OverlayMenu（整组注入/改名/删除组；公共组仅整组注入）；移除 × 按钮；恢复 renameGroup |
| S1 | settings/sections/*.tsx | ParamsSection .set-row+单位；archive/theme/proxy/本地模型档位 4 组 radio → SegmentedSlider |

### 部分完成 / 后续补强
- S1 ③「整页所有 section」：已修证据点名的两处缺陷（ParamsSection 数字框对齐、归档三选）并消除全部 radio；字体/模型卡/数据目录等异构 section 无该缺陷，保留原布局（避免高风险重排），如需统一可后续逐节推进。

### 验证证据
- `tsc --noEmit` EXIT=0；`vite build` EXIT=0（产物含 CubeView chunk）
- 后端 `py_compile` 全改动文件 EXIT=0；`import main` OK（VERSION=0.1.9）
- 运行时冒烟（实库 2 文档）：/api/health=0.1.9；/coords/pending_count={count:2}（L3 新端点）；/relations/pending_count={count:2}；/rebuttal/options styles 含 daily、formats 含 plain；archive-policy/proxy/params 端点正常
- R1 迁移器单元验证：旧 styles.md（无 daily）启动后补齐 daily、用户自定义小节原样不动；幂等（二次运行无变更）
- LibraryFace.tsx mojibake 修复（GBK 双编码损坏 → 重写恢复 UTF-8）

### 版本号同步
- config.py VERSION = "0.1.9" ✅