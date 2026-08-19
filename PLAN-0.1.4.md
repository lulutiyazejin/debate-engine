# PLAN-0.1.4 · 数据继承 + 组件中心 + 统一阅读器 + 视觉精修 + 回应面合一

> 版本定位：0.1.4 = 把 0.1.3 暴露的**数据继承断点**根治（迁移/升级保护），外部能力全部
> 设置内下载（组件中心），查看与入库分家（统一阅读器），回应面三轴合一去臃肿，
> 视觉四件（主色系/线减法/高度阶梯/滚动条）收尾纸感高级感。
>
> 设计参照：用户截图（赛博史官模型管理卡/数据目录块）、Zotero collections、
> ComfyUI-Manager、Radix Colors/M3、OfficeToHtml 组合
> 上版计划：PLAN-0.1.3.md（已发布 v0.1.3，main=9cc361b）

---

## 已确认决策记录

1. 数据恢复 B 已执行：0.1.3 重装回 Z:\DebateEngine，C 盘测试目录已卸载清除（注册表回 Z）
2. 数据目录迁移：设置「数据目录」块（路径只读+迁移…按钮，同用户截图范式）；流程=wal_checkpoint(TRUNCATE)→整目录复制（带实时进度：体积/速度）→%APPDATA%\DebateEngine\data-root.txt 写覆盖→提示重启；**旧目录保留并在设置显示路径+手动清理提示**；config 全路径走派生变量，硬编码清零
3. 任务分工编辑器：PATCH /api/config/task-chains（校验服务商存在、链非空、offline 兜底不写入）；前端每行编辑链（上移/下移/停用/置顶首选）；当前落点列实时刷新，首选不可用时注「实际落点 xx」
4. 设置退出钮 = 自绘线型「→」图标钮（title 保留「关闭 (Esc)」）
5. md 转换分档：frontmatter 标 `source_format`+`conversion: full/lossy/summary-only`；干净全文=txt/md/docx/URL；有噪=文字层PDF/.doc；不适合=扫描PDF/xlsx/图表PDF（只元数据+摘要md）；**AI 链路维持内存提取，md 只作归档副产物**
6. 档案库：`knowledge_base/archive/{立场}/{作者}/{同名}.md`+原件；确认后三选 复制/迁移/不归档+「记住选择」写 settings `archive_policy`（**设置知识库分区留改入口**）；批量整批问一次；URL 只归档 md；作者缺=未知作者；撞名=版次→出版年→序号；**edition 进联网补抓候选**；reassign_stance 第七处同步；删文档默认保留档案+可选同时删
7. OCR = RapidOCR（PaddleOCR 权重转 ONNX，不背框架）；文字层空→OCR 分支→无组件显式报告；**设置内下载**（不进 NSIS）
8. 政府站导入：read_html 全表抽取→md 表格节；附件链接（xls/xlsx/csv/pdf）发现→确认屏提示一并下载导入走批量管线；csv 进支持清单；utf-8→gbk/gb18030 回退；403 反爬显式报告；akshare 记债（借接口定义不重写解析）
9. 解析三档：轻=pypdf+借 pdfplumber 表格+借 MarkItDown 转换逻辑；重=docling 可选分支（parsers.py 已有）；MinerU 外部引擎记债（检测+链接）
10. 统一阅读器（查看与入库分家）：格式调度 pdf→pdf.js 原页+文本模式切换 / xlsx·xls·csv→后端 pandas 行+前端 sheet 页签自绘虚拟表格 / docx→mammoth 块 / md·txt→marked / 扫描pdf→页图+OCR 文字层（组件）/ 图片直显；统一外壳（顶栏文件名+格式徽章+conversion 标注+模式切换）纸感 token；后端 GET /docs/{id}/view（大表分页）+ GET /files/{id} 原件流；入口=馆藏卡打开原件/档案库点击/确认屏预览
11. 组件中心（设置分区）：BGE-M3(~2.3GB)/OCR包(~50MB)/docling包；**断点续传 Range+sha256 校验+代理三态+GitHub Release 主源/ModelScope 镜像备选+热生效优先**；卡片四态（未装/下载中/已装/禁用）+自检/删除/下载重下（借 ComfyUI-Manager，禁用=排障轻操作）；落盘 engine/_extras/{name}/ 挂 sys.path，模型落 data-root/models；**BGE 装完弹「建议全库重嵌入」一键+进度**（向量表 embedding_model 圈定重算）；MinerU 只检测+官网链接
12. 设置一滚到底：十→十二分区顺序铺开单滚动条；左导航变锚点目录+scrollspy 高亮；序按频率：服务商/本地模型/组件中心/网络与代理/任务分工/生成与检索/知识库(迁移+归档策略)/立场管理/知识文件/诊断与日志/界面/软件信息
13. 主色系 OKLCH：预设低饱和 swatch（朱红默认/黛蓝/松绿/赭黄/绛紫）+自定义色相滑杆；锁 C/L 阶只换 H；--accent 浅L.45/深L.65、--accent-dim 同H降C alpha.12；**WCAG 对比不足自动调 L**；--err（关钮红点）/stance-1..6/导出报告不跟主色；存 localStorage de.accent
14. 三轴合一：意图并入风格表（反驳+反驳→反驳；批判+批判性分析→批判性分析吸收结构攻击 prompt；评价新增吸收多立场权衡 prompt；共 14 条）；tab=回答/分析/综合报告；**评价 stance_free：选到时立场选择器隐藏，后端 stance 收 "none" 跳过 skill 注入**；主行=风格/立场/格式/字数+生成回答；引用/检索/坐标/谬误进高级折叠；styles.md 合并 INTENTS extras；历史旧 intent 显示映射+回填转 style+存KB 文件名用 style 名；**中立评价存档进 archive/中立评价/ 不回落首立场**
15. 素材组：material_groups 表+素材 group_id（必属一组无孤儿）；公共素材组 pinned 永置顶不可删改；手动建组命名；删组材料并公共组；存储无上限，**单次注入预算 20**（prompt 物理限制，计数 n/20）；右键「加入素材组▸」子菜单（公共默认）；整组注入快动作；顶栏角标=总数；旧 basket 存量迁移归公共组
16. 细线减法 11→4：留 功能条下缘/工具区下缘一条/控件描边/纸叠层阴影；删 两竖栏线(改明度差侧栏bg-0中栏bg-1)/左栏节头线/tab行下全线×2/筛选行下/右栏两条；--hairline-strong 白名单=控件+功能条
17. 高度阶梯 40/32/24 三档：功能条与三栏顶行同水平线；一切交互控件 32 同行同高；tab 选中=32 高 accent-dim 块零跳变；标签 fs-12 muted/值 fs-13/caps 仅栏头；留白只准 sp-3/sp-4/sp-5；搜索框 max-width 560、年宽 88、主钮同高 32
18. 图谱缩放 bug：host overflow:hidden 斩回环+observer 等值守卫；ref 显式管缩放（load 后 zoomToFit 一次，chip/选档保持视口）；验收连点 10 次不缩
19. 滚动条 token 化：scrollbar-width thin+scrollbar-color+::-webkit-scrollbar 族（thumb=--hairline-strong hover=--tx-3 track 透明 10px）
20. 文档树入馆藏：馆藏 tab 主从（左=立场分组树带折叠，右=现馆藏内容）；知识库面去常驻左栏；统计三数变紧凑条进馆藏头部；树=组头点击折叠/计数/全展全收/折叠态记 localStorage/外部跳转自动展开滚到可见
21. combobox：输入即滤（标题/作者/拼音首字母）+命中字 accent 高亮（候选+馆藏检索结果同套 mark）+虚拟列表+↑↓Enter/Esc；应用=图谱文档/对比甲乙/立场选择/馆藏树过滤；模糊匹配共用 util；无匹配显「无匹配+已搜范围」；选中项旁「查看」小钮开右栏
22. 安装器预置 skill 保护扩到 styles/fallacies/centers/stances 全部预置文件：存在即跳过或 .bak
23. 0.1.4 新特性三步导览（回答合一/素材组/组件中心）复用 tour 框架
24. 发布多 asset：组件包 zip 随版上传（upload-release.ps1 已支持多 asset 循环）

## 借鉴清单（联网调研落位）

| 项目 | 抄谁 | 抄哪手 | 不抄 |
|---|---|---|---|
| 13 主色系 | Radix Colors/M3 | 单色生成固定阶、深浅算法配对、对比度兜底 | Radix 12 步命名重造 |
| 15 素材组 | Zotero collections | 原件单一集合即视图、删集合不删条目 | 多集合成员制；tags 维度记债 |
| 11 组件中心 | ComfyUI-Manager | 装/卸/禁/启四态、断点续传、镜像 | 社区 Hub |
| 10 阅读器 | OfficeToHtml | pdf.js+mammoth+SheetJS 组合 | handsontable（许可）→自绘 |
| 8 政府站 | akshare | 统计局接口定义与解析结论 | 全量金融接口 |

## 8 批 × 24 项

### 批 0 · 视觉纯前端（零依赖先做）
- 4 →钮 · 15 主色系 · 18 线减法 · 19 高度阶梯 · 21 滚动条

### 批 1 · bug 优先
- 20 图谱缩放（独立最优先）

### 批 2 · 布局+选择器（互依同批）
- 22 文档树入馆藏+折叠 · 23 combobox+高亮（共用模糊 util 先行）

### 批 3 · 回应面合一
- 16 三轴合一（styles.md 合并+后端 none+历史映射+中立评价归档目录）

### 批 4 · 素材组
- 17（DB 迁移+API+UI+整组注入+角标）

### 批 5 · 设置长页族（同页聚批）
- 14 一滚到底 · 2 数据迁移 · 3 任务链编辑器 · 11/13 组件中心（NDJSON 进度 util 与 ollama pull 共用先行）

### 批 6 · 导入/归档/阅读器族（内部按依赖）
- 5 分档 frontmatter → 6 档案库 → 8 政府站 → 9 解析三档 → 10 统一阅读器 → 7 OCR 组件

### 批 7 · 收尾
- 1附/22 skill 保护 · 23 导览 · 版本号三处 · release 多 asset · E 验收（红线单+pytest 新用例：旧库迁移/历史兼容/删组并公共/chain 编辑/迁移回环）

## 验收红线

1. 连点 chip+文档 10 次图谱不缩 · 深色滚动条灰
2. 三栏顶行一条线 · 同行控件像素同高 · tab 零跳变 · 切主色全软件跟动（报告/红点/stance 色不动）
3. 搜「阶级」候选高亮 · 折叠跨立场零滚动 · 外部跳转自动展开
4. BGE 装完重嵌入引导出现 · 掐代理断网续传可用 · 禁用态热切换
5. 删组材料入公共组 · archive_policy 设置可改 · 评价隐藏立场且存档进中立评价
6. 0.1.3 旧库（Z 盘）升级后原样打开 · 手改 styles.md 不被覆盖
7. 迁移进度可见 · 旧目录保留且显示 · 2.3GB 复制不似卡死
8. 旧历史显示/回填/存KB 全正常
9. pytest 全绿+tsc+vite · 零 cmd · 截图 DPI-aware 复核

## 记债

- 图谱 G6 迁移（0.1.3 续债）· akshare 可选组件 · MinerU 外部引擎 ·
- 素材 tags 跨组维度/saved-search（Zotero 借见）· D5/D8/D9 低优视觉 · 自定义立场颜色/图标

## 改动台账

（批 0–7 执行时追加）

## 版本执行策略（架构红线同步）

本版采取**Phase 0 清隐患 + 随批拆包**的并行推进：不先做一次性大重构，而是把拆包与开发同批完成，减少回归风险并缩短周期。

### Phase 0 · 清隐患（轻量、低风险、零侵入，写在 0.1.4 开头）

| # | 任务 | 文件/模块 | 动作 | 影响面 |
|---|---|---|---|---|
| 0-1 | HashEmbedder 改名 | `models/embedder.py` / `embedder_status()` | `name="bge-m3-v1.5#hash"`；docs/schema 注明实现类型差异 | BGE 装完引导全库重嵌入范围准确（embedding_model 列不变）+ 向量表兼容旧数据 |
| 0-2 | 刷新 §5 豁免表 | `Software Architecture.md` §5 | 执行 fresh line-count scan → 更新文件名路径与行数阈值；删除过期项（app→desktop 目录已迁） | 红线管理表与实际代码同步 |
| 0-3 | upload-release.ps1 对齐 | `backend/packaging/upload-release.ps1` | 注释默认只传源码；确需安装包加 `-WithInstaller` 开关 | AGENTS.md 规则一致化；避免误上传二进制产物 |

验收标准（Phase 0 必须绿）：tsc 无错 · pytest 全绿（含 embedder 测试）· 脚本自测通过。

### 批内拆包规则（与主流程同批聚批）

- **批 5**：设置长页族 → SettingsPanel（拆为 providers/ollama/network/stancemgr/kb_migration/about 子组件）+ settings.py（拆分 proxy/ollama/chains/web_enrich 路由 + 共用 utility 先行）
- **批 6**：导入/归档/阅读器族 → indexer.py（parser 独立、索引构建函数化）、sqlite_store.py（分 migrations.py + SQL chunks，ALTER/INSERT 按块）、reader views 模型与 parser 壳分离（pdf.js/mammoth/SheetJS 各自成模块）
- App.tsx/combobox/LibraryFace 轻项合并到对应批（22+23 combobox 即拆出通用 Hook + UI）

红线执行纪律：触预警线就拆（不等强拆）；每个拆出文件须一句话职责说明（放入 docstring/TS comment）；批边界三件事（编译 → 复读 diff → PLAN 台账追加）。

### 记录债清单（随拆包逐条销账）

| 来源 | 内容 | 处理状态 | 责任批次 |
|---|---|---|---|
| Software Architecture.md §5（旧） | app/src/features 过时 → desktop/src/panels | 0-2 刷新 | Phase 0 |
| embedder.py | HashEmbedder 同名伪装 BGE-M3 | 0-1 改名 | Phase 0 |
| SettingsPanel.tsx / backend/settings.py | 膨胀至 671/281 行 | 5-B 拆分 | 批 5 |
| indexer.py / sqlite_store.py | 522/476 行，over limits | 6-A 拆分 | 批 6 |
| App.tsx | 424 行 | 23/CB 抽取 | 批 2 |

执行完毕后销账：每拆一件，在 PLAN 台账加一行“拆出 XXX，行数 XX→YY"。

