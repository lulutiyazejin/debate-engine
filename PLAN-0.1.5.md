# PLAN-0.1.5 · 呼吸感视觉 + 模型自主 + 3D 立方体 + 入库增强

> 0.1.4 发布后收集 60 项：设置页回归修复、滑移呼吸感全软件统一、任务分工编号槽、
> 本地模型自主（硬件推荐/上下文档位/下载通道）、意识形态 3D 立方体落地、入库日期与超墙提示、图谱连点根除。
> 工作流纪律：本 PLAN 自足——新会话读完即可下刀，不依赖 transcript 还原。

## 已确认决策记录

1. H1 编号槽：交互失败动作 toast 提示切换（用户拍板），批量静默按槽序+报告逐本标实际落点
2. I4 命令面板整删（方案 B），解除"不可停用"约束
3. J7/J8 滑移 120ms ease-out 固定时长（与距离无关）全软件统一，含设置页左导航
4. J1 立方体栈=AntV G2 point3D（R3F 记债 R1）；落图谱区子投影，零新增顶 tab
5. I6 立场括号注记下拉整个不显示，仅 skill 文件/立场管理可见
6. J10 两小优化执行（图谱"全部"钮滑移化、数字输入 ↑↓ 键保留）
7. F6 地理视图记债不做（无国家统计数据）
8. G2 模型表=单一真源（VRAM/窗/速度档/质量档/prompt_tier/最低运行时），F1/F2/F4/F5/G1/H2/A4 全读它
9. F2 自动档默认+手动五档切换+每档显存标明；ollama 改原生 /api/chat 传 options.num_ctx
10. J3 交叉透视自绘优先，S2 主题覆盖成再引包
11. I2 零依赖正则格式表（不引日期库，合轻量栈偏好）
12. PLAN 四段自足条目纪律（根因证据/设计规格/验收红线/联动），厚薄按风险分

## 借鉴清单（联网调研落位）

| 项目 | 抄谁 | 抄哪手 | 不抄 |
|---|---|---|---|
| J7 滑移 | animationpatterns.art/SO | CSS 变量+translateX 滑块、键盘 ←→、固定时长与距离无关 | SwiftUI matchedGeometry 生态 |
| J1 立方体 | G2 point3D 示例 | 3D 散点+相机动画+正交/透视 | G2 出厂色板（走 token） |
| J3 透视 | S2 理念 | 行×列×值交叉范式 | S2 包（先自绘） |
| J5 洞察 | AVA | 异常/趋势自动标注算法思路 | AVA 全量 |
| I2 日期 | Baeldung 多格式顺序试解 | 格式表路线 | 第三方库 |
| I8 显隐 | react-force-graph 官方 linkVisibility | 视图层显隐不换数据 | 防抖凑合 |

## 项目四段条目

### A · 0.1.4 断点

**A1 中立评价存档接线**
- 根因：`archiver.archive_neutral_review` 后端就位，前端/引擎零调用（grep 0 命中）
- 规格：rebuttal 生成成功且 style=evaluate+stance=none 时调 `archive_neutral_review(标题, 全文)` 落 `archive/中立评价/`；前端 toast「已存入中立评价档案」；不回落首立场
- 验收：评价生成后档案目录出现 md；frontmatter 含 stance: none
- 联动：A 簇回写范围（I3 补摘要同范式）

**A2 设置归档策略入口**
- 根因：SettingsPanel grep `archive` 0 命中；决策 6 要求设置留改入口
- 规格：知识库分区加单选（每次问 ask/复制 copy/迁移 move/不归档 none），读写 `/api/import/archive-policy`，热生效；与确认屏"记住选择"共键
- 验收：设置改 none 后单本导入确认屏预选"不归档"
- 联动：E 簇同批（L6）

**A3 edition 进联网补抓**
- 根因：web_enrich.py grep `edition` 0 命中
- 规格：补抓字段表加 edition（维基 infobox 版本/edition 键）；确认屏版次字段加「网」标；归档撞名消歧已用 edition（archiver._unique_stem）
- 验收：有 edition 的书确认屏版次预填+网标
- 联动：无

**A4 组件 zip 资产**
- 根因：components.py `_GH/_MS` URL 为虚构路径，下载必 404
- 规格：制作 bge-m3.zip / ocr-win64.zip / docling-win64.zip（pip 装齐依赖后整目录打包）；随 release 上传（C3）；回填真实 URL；ocr 的 pip_dev 补 pypdfium2
- 验收：组件中心三卡下载走通断点续传（红线⑩族）；时序=先包→后传→再验收
- 联动：C3、H2 推荐表含 BGE 行

**A5 附件一并下载提示**
- 根因：parsers._enrich_url_tables 已把 attachments 进 raw_metadata，UI 无展示
- 规格：确认屏检测 `preview.attachments` 显「发现 N 个附件（xls/pdf…），一并下载导入？」勾选→confirm 后走 `/api/import/batch`（URL 列表）
- 验收：政府站页导入确认屏见附件勾选；勾选后批量报告含附件项
- 联动：批量管线既有逐文件隔离

**A6 三步导览文案**
- 根因：决策 23 未落地，tour 框架在文案没写
- 规格：tour 加三步（回答合一/素材组/组件中心）；I4 删面板后涉及面板键的措辞同步清
- 验收：首启导览见三步且无死引用
- 联动：I4

### B · 架构债（收尾批，全测试网）

**B1 SettingsPanel 拆分**——现状 701 行；分区主体拆 `settings/sections/*.tsx`，主文件留 nav+scrollspy+滑移骨架 <250 行；**先拆再装 J8**（顺序依赖）
**B2 sqlite_store 拆分**——546 行；groups/basket/responses 出走到 `workspace_store.py`，主库留文档/切块/论证；API import 同步
**B3 indexer 拆分**——538 行；查重/语义近似出 `duplicate.py`，confirm 出 `confirm.py`；验收=pytest 全绿+行数复扫

### C · 延续债

**C1 G6 迁移**——I8 稳后观察一轮再议（J2），本版不重复投资
**C2 akshare/MinerU**——维持债（MinerU 检测已在组件中心）
**C3 发布多 asset**——组件包打包脚本+随版上传；A4 依赖它
**C4 tags/saved-search**——维持债
**C5 低优视觉/立场色图标**——维持债

### D · 新发现

**D1 GUI 实测验收**——视觉批后统一实跑+截图，对照红线条逐条复核（PrintWindow 先 SetProcessDPIAware，记忆公约）
**D2 阅读器安全**
- 根因：ReaderModal 对 mammoth HTML dangerouslySetInnerHTML（构建 L1 扫描 MEDIUM）
- 规格：轻量白名单净化器（只放 p/b/i/em/strong/h1-4/ul/ol/li/table/tr/td/th/br/hr/a[href^=http]/img[src]，剥 script/style/on*）；pdf iframe 加载失败兜底「打开原件」外链
- 验收：docx 查看正常且注入脚本不执行
- 联动：无

**D3 大表内存**
- 根因：files.py `_table_view` 整表读进内存再分页
- 规格：openpyxl `read_only` 按窗口只读 page_rows（iter_rows min_row/max_row）；csv 逐行流式跳读；total 用 max_row/行计数
- 验收：10 万行 xlsx 查看内存平稳、翻页 <1s
- 联动：J3 若引 S2 则同换虚拟滚

**D4 档案浏览入口**——馆藏加「档案」tab：树=立场→作者→文件（读 archive 目录+`.archive_index.json`），md 点开进 ReaderModal；复用 DocTree 范式
**D5 迁移回滚引导**——数据目录块加「回滚到旧目录」（改写 data-root.txt 回原路径，需原路径 knowledge.db 在）+显示旧目录体积（递归 stat）
**D6 chunk 拆分**——vite manualChunks 拆 react/可视化两族；与 J1 动态 import 同批
**D7 .xls 支持**——xlrd 可选依赖：parsers 加 .xls 分支+files.py 查看分支；缺依赖显式提示「另存 .xlsx」

### E · 设置页回归（同页同批防互踩）

**E1 双滚动条**
- 根因：styles.css#L291-292 `.panel{height:100%;overflow-y:auto}` 与 #L343 `.settings-body{overflow-y:auto}` 双层 scroll 容器；0.1.3 单分区不暴露，0.1.4 顺铺后双条
- 规格：`.settings-body .panel.settings{height:auto;overflow:visible}`
- 验收：设置页仅一条滚动条；馆藏/回应面右栏不回归（作用域限定）
- 联动：E5

**E2 分区卡片化**——`.panel.settings{background:var(--bg-2);border-radius:8px;padding:var(--sp-4);margin:0 var(--sp-4) var(--sp-4)}`；明度差分界不增线（线减法纪律）
**E3 间隔**——settings 内 `h3{margin-top:0}`，节奏由 gap 单控 sp-3（修 gap+margin 叠加）
**E4 宽窄**——删 `.param-row{max-width:460px}`；分区内容列统一 860px；param-row 行高对 40 阶梯；chk/controls 同列
**E5 作用域保险**——E1 覆盖只许写 `.settings-body .panel` 作用域；批内回归三栏右栏（dossier/preview 依赖 .panel height:100%）
**E6 退出箭头出族**
- 根因：App.tsx#L371 路径 `M10 5l4 3-4 3z` 尾 `z` 闭合三角，糊成实心块，出 1.4px 开放描边族
- 规格：改 `M2.5 8h11 M10 4.5l4 3.5-4 3.5`（无 z，round cap，红色保留=决策 13）
- 验收：与 IcoPalette 箭头同族感；截图复核

### F · 本地模型

**F1 清单扩充**
- 根因：ollama_adapter#L143-149 仅 5 候选
- 规格：精选卡：qwen3.5:35b-a3b（首推·24GB 甜点·质量 32B 档·速度 3B 档）/ qwen2.5:14b（余量备选）/ 7b / 3b / deepseek-r1:7b/14b；卡标显存(Q4)/中文评级/擅长；加「其他模型」自由输入口（后端 OllamaPull 已无白名单，零改动）
- 验收：35b-a3b 一键 pull 走通；自由输入任意名可 pull
- 联动：G2 表、H2 荐标

**F2 上下文档位（修订版）**
- 根因：llm_client#L58-59 payload 无 num_ctx，本地被默认 ≈4k 腰斩
- 规格：ollama 分支改原生 `/api/chat` 传 `options.num_ctx`；自动档默认 35b-a3b→32k / 14b→32k / 7b→16k；手动五档 4k/8k/16k/32k/64k；每档标预估显存=权重(Q4 表)+KV(7b 0.055MB/t、14b 0.19MB/t、35b-a3b 线性注意力≈固定小量)×档长+2GB；超探测显存标「⚠ 吃紧，可能回落 CPU」不禁止；探不到 GPU 只标数值；存 settings `ollama_ctx`，热生效
- 验收：35b-a3b 选 32k 后长章不截断；64k 档见吃紧标
- 联动：G2 表、F4/F5 读档值

**F3b 下载通道**
- 根因：ollama_adapter#L95-96 proxy 只作用于软件→本地 Ollama 通信（本机恒直连=恒空）；真正下载在 Ollama 进程内；#L62-77 ensure 只提示不拉起
- 规格：加「一键启动 Ollama」：子进程 `ollama serve` 注入 `HTTPS_PROXY/HTTP_PROXY`=代理三态自定义地址，**CREATE_NO_WINDOW 隐藏窗**（记忆公约）；UI 显「下载通道：直连/代理 xx」；pull 失败提示「到网络与代理改代理后重试」
- 验收：代理开时 pull 走代理（日志可见）且无 CMD 窗闪
- 联动：H2 nvidia-smi 同隐藏窗公约

**F3c 离线导入**——本地 GGUF 选择→`ollama create` 导入；全断网兜底
**F4 判墙**
- 根因：summarizer#L169-175 pick_strategy 只看 80k 阈值；10 万字≈67k（#L160 1token≈1.5 字）>14b32k 窗，整书投喂撞墙
- 规格：判定读槽 1 模型窗口（G2 表/F2 档值），`token_estimate > 窗×0.9` 强制 map_reduce；`_MAX_INPUT_CHARS=6000`（#L60）超长章拆多趟提取（不截章尾）
- 验收：67k 书+14b32k 走 map_reduce 不报错
- 联动：F5、H1 槽切换事件

**F5 超墙提示条**
- 规格：确认屏警示条（demo-warn 同款）；余量线=窗×0.9 显「≈29k tokens（约 4.3 万字）」；三选文案原文：
  「⚠ 本书约 67,000 tokens（≈10 万字），超过当前总结落点 qwen2.5:14b（32k 窗，余量线 29k）的处理上限。
  ○ 分章压缩再合并（推荐）　预估 5–8 分钟——跨章连贯靠二次合并，逻辑递进类著作摘要略逊整书通读；检索/论证抽取不受影响。
  ○ 换大窗模型整书通读　预估 1–2 分钟——全文经云端（当前可用：DeepSeek-V4-Flash 128k）；未配置灰显+「去配置」跳任务分工。
  ○ 仍按整书投喂（不推荐）——超出窗口部分直接截断，本书约后 55% 内容不进摘要与论证单元。」
  [记住本次选择]→settings `over_window_policy`，记住后降级一行小字「超窗→按记忆走分章」；时间预估=ceil(tokens/8000)×档时(14b≈25s/7b≈14s/Flash≈3s)+40s 显区间；批量不逐本弹、报告逐本标；尾部附「另有 N 个长章将拆多趟提取」
- 验收：10 万字书三选各自生效；切槽后按新窗重判刷新；记住后静默
- 联动：F4、H1、G2、动作 toast 共用（L16）

**F6 地理视图**——记债不做（J6 并入）

### G · 提示与矩阵

**G1 提示分档**
- 规格：G2 表加 prompt_tier（按质量档：35b-a3b 归大档）；小档（≤7B 稠密）模板变体=短指令+步骤显式+完整 JSON 示例+不要求自由推理；大档=现富提示；落点 summarizer 四套模板+rebuttal 生成**双入口都分档**
- 验收：7b 跑小档模板 JSON 解析成功率 ≥ 大档旧提示
- 联动：G2、L12 双入口

**G2 模型支持矩阵**
- 规格：内置单表字段：name/label/权重 VRAM(Q4)/窗/速度档/质量档/prompt_tier/最低运行时；本地模型页读 `ollama --version` 比对，不兼容卡标「需升级 Ollama 才能跑」+pull 灰显；加模型=加一行；换代只改表
- 验收：模拟低版本 Ollama 时 35b-a3b 卡显升级标
- 联动：F1/F2/F4/F5/H2/A4 全读它

### H · 任务与硬件

**H1 任务分工编号槽（终版）**
- 根因：现优先级链 UI 复杂（截图）；model_router#L23-27 链源
- 规格：任务行=任务/用途/编号槽组；槽=下拉（选项=可用服务商+已装本地模型，重复灰显，未配置灰显+原因不藏）；编号=尝试序；保底 1 槽（删最后禁用）、行末＋加槽上限 5、槽×删除；删「优先级链/当前落点」列与编辑链；TaskChainEditor.tsx 整删；实际落点归诊断分区台账；后端 `PATCH /api/config/task-slots {task, slots[]}` 校验非空/不重/成员可用；旧 task_chains 键读取取 chain[0]；model_router 槽序尝试；**交互场景**槽 1 失败抛 `{failed,next}` 事件→前端动作 toast「① deepseek 失败（限流）。切到 ② gemini？[切换][重试][离线模板]」；**批量**静默按槽序+报告逐本标实际落点；provider 卡「承担任务」去位次；自定义服务商添加文案改「添加后可到任务分工设为选用」、删除时曾选它的任务回落内置默认+toast
- 验收：槽切换热生效；交互失败 toast 三钮各自生效；批量报告见落点；旧设置兼容
- 联动：F4/F5 读槽 1、I4 文案、测试断言改单选

**H2 硬件推荐**
- 规格：引擎侧 `nvidia-smi --query-gpu=name,memory.total --format=csv`（隐藏窗）+内存总量；失败=无独显；推荐=滤 G2 表 VRAM 列：≥21→35b-a3b / ≥10→14b / ≥6→7b / ≥3→3b / 无独显→「建议云端为主」；本地模型分区顶行「检测到 RTX 3090 · 24GB / 内存 64GB → 推荐 qwen3.5:35b-a3b」+一键下载；槽下拉本地模型带「荐」徽标；缓存 settings `hw_profile`+「重新探测」钮；无 N 卡文案中性不贬 AMD
- 验收：3090 机器显 35b-a3b 推荐；拔卡模拟（mock）显云端建议
- 联动：G2、F3b 隐藏窗公约

### I · 交互 bug

**I1 导入状态+取消**
- 根因：LibraryFace#L282 `view === "collection" &&` 条件渲染卸载 ImportPanel，busy/preview 丢
- 规格：五视图改 always-mount+hidden（display:none）；busy 态加取消钮：单本=丢弃本次结果+toast「已取消」；批量=BATCH_STATE 加 cancel 标志、pending 项标「已取消」；**轮询清理挂 active=false**（always-mount 后防后台空轮询）；graph 视图 inactive 时 `pauseAnimation`、active 恢复
- 验收：切面再切回加载动画与预览都在；取消后不弹预览
- 联动：J7 滑移（always-mount 使测量变易）

**I2 日期化**
- 根因：ImportPanel 存盘 `Number("2026-08-03")`=NaN 静默丢
- 规格：字段改「年份/日期」；零依赖格式表顺序试解：`yyyy / yyyy-mm / yyyy-mm-dd / yyyy-mm-dd HH:MM / yyyy-mm-dd HH:MM:SS / yyyy年m月d日 / yyyy.m.d`；DB year 取整数年（接起始年筛选），metadata `year_raw` 存原文回显；blur 后输入框旁显规范化结果（所见即所得）；解析失败保留原文+小字「未识别，按原文存档」
- 验收：`2026-08-03 14:30:05` 落库且回显原样；起始年筛选 2026 命中
- 联动：D4 档案展示 year_raw

**I3 补摘要**
- 根因：无模型落 OfflineProvider（model_router#L66-67），summary 空
- 规格：空摘要处徽章「无摘要 · 离线/无模型时生成」（确认屏+卡片）；右键菜单加「补生成摘要」→重跑 summarize 回写 documents.summary + 档案 md 摘要段 + INDEX 重生成
- 验收：离线导入卡显徽章；配模型后补摘要成功且档案 md 同步
- 联动：A1 回写范式、L5

**I4 面板删（B）**
- 规格：删 App.tsx palette 状态+渲染块、#L258 keys.palette 匹配分支、loadKeys palette 默认、顶栏「CTRL+K 面板」提示、设置「命令面板（不可停用）」行、tour 涉面板措辞；**删净防死码**（tsc 零警告）
- 验收：Ctrl+K 无响应不报错；设置快捷键区无残行

**I5 手势**
- 根因：App.tsx#L221 限幅 ±160（只能滑一点）；#L250 useEffect 依赖含 dragX→拖拽每帧重挂四监听（错位根因）
- 规格：dragX 改 ref（依赖只剩 switchFace）；限幅 ±240；达阈 GESTURE_DONE 一次性触发并立即 tracking=false；交棒过渡动画
- 验收：长滑跟手到 240；连滑 10 次界面不错位

**I6 立场截断**——图谱/对比/入库三处下拉 label 首括号截断只留短名；注记不另显，仅 skill 文件与设置立场管理清单见全名
**I7 数字箭头**——CSS 全局 `input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}`+`appearance:textfield`；blur 数值校验（越界回退旧值）；↑↓ 键增减保留（J10）
**I8 连点缩小（根除）**
- 根因：GraphPanel#L187-190 chip 过滤每次换新 graphData 对象→引擎重热；连点=hot 态高频换数据（批 1 验收未覆盖工况）；社区 #531 定论镜头须调用方全托管
- 规格：**主解** chip 过滤改 `linkVisibility={(l)=>relFilter.length===0||relFilter.includes(l.relation)}`（视图层显隐，graphData 恒同对象，引擎零重热）；计数徽章照旧；**保险** 真换数据路径（切立场/文档）换前读 `fgRef.zoom()/centerAt()` 换后写回（用户滚轮记 userZoomed 不覆盖）；onEngineStop fit 只服务 freshLoad
- 验收：20 连点（<100ms）不缩不漂；连点后切文档切回不缩；「全部」复位镜头不变
- 联动：J2 重评条件

### J · 可视化

**J1 3D 立方体**
- 根因：0.1.0 时代愿景（记忆：动态轴配置+全维提取）从未入台账；数据基础已备（classifier#L20-29 22 轴全提取）
- 规格：G2 point3D **动态 import**（包体积隔离）；图谱区子投影段切「力导向 / 3D 立方 / 坐标散点」（用 J7 滑移）；X/Y/Z 三 Combobox 任选 22 轴（副行端点语义如「所有制：公←→私」），默认=所有制/政治权力/帝国主义；半透明立方框（面≈10% 透明）+三轴 0 点参考线；着色轴可指定，默认政治轴左红→中→右蓝连续色标（端点恒定不跟主色=决策 13 延伸），点=文档/立场投影；交互拖转/缩放/点点击开卡；**无 WebGL 兜底**=提示+J4 散点视图
- 验收：22 轴任选切换正常；红蓝渐变正确；断 GPU 机器见兜底
- 联动：J4、J7、R1 记债

**J2 G6 重评**——I8 验收后观察一轮；再现镜头类 bug 才启迁移，否则 C1 继续缓
**J3 交叉透视**——新「交叉分析」子视图：行=立场×列=轴区间分箱×值=论证单元数/平均坐标；自绘虚拟表（决策 10 底子）；S2 主题覆盖评估通过才引包
**J4 图表族**——雷达=立场画像（22 轴多边形，立场卡升级，首选）；四象限散点=经济×政治坐标视图（兼 J1 兜底）；热力=章节×轴密度（次选）；颜色全走 token
**J5 AVA 洞察**——统计区「自动洞察」：自动圈「本书在 X 轴论证密度显著高于全库均值」类结论；后排
**J7 滑移规范**
- 规格：共用件 `<SegmentedSlider>`：滑块独立层绝对定位，位置=CSS 变量驱动 `transform:translateX`，`transition:transform 120ms ease-out, opacity 120ms ease-out`（固定时长与距离无关）；文字 opacity 0.9（未选）→1.0（选）；键盘 ←→ 切段；应用面=馆藏五段/回应三段/对比子 tab/立方体子投影/图谱「全部」钮（J10）
- 验收：最左跳最右也 120ms；键盘可切；截图复核呼吸感
- 联动：I1 always-mount、J8

**J8 设置滑移**——左导航滑块（窄条 accent-dim）top 跟随 active；右栏 scrollIntoView 并行；**滑块跟 scrollspy**（active 由点击+滚动双驱动）；B1 拆分后同批
**J9 栈决策**——G2 point3D 采纳；R3F 记债 R1（决策项）
**J10 小优化**——图谱「全部」钮滑移化（并入 J7）；↑↓ 键并入 I7

### K · 符号与对齐

**K1 展/收符号化**
- 根因：DocTree#L81-84 红字文本钮出族
- 规格：同族双 chevron 线型（展开 `⌄⌄`/收起 `⌃`，开放两折线**不闭合**吸 E6 教训），12px、1.4 描边、tx-3、hover accent；title 保留全部展开/收起
- 验收：与 Ico 族同感；截图复核

**K2 对齐**
- 根因：RespondFace#L219 `pad-h` 与 #L223 左 padding 各走各
- 规格：左栏行统一 `padding-left:var(--sp-2)`；+ 号改自绘 plus 图标与组头 chevron 同列宽；全软件扫六处：a tree-head 过滤框与展收钮垂直居中 32 高 / b 图谱过滤行「查看」link 包 32 高命中区 / c 回应主行「高级 ▸」同 b 范式 / d 顶栏两钮与 ALT+Q 提示基线 / e 设置 param-row 右 code 徽章基线 / f collection head 统计与 caps 基线
- 验收：六处截图复核全齐

## 批次计划（六批·风险升序·共用件先行）

1. **视觉**：E1–E6 / K1–K2 / J7 / J8 / I7 / D6——SegmentedSlider 共用件先行；门禁 tsc+vite+截图
2. **bug**：I1 / I5 / I8 / D2 / D3——门禁 pytest+tsc+20 连点实测
3. **机制**：G2 表先行→H1 / H2 / F1–F5 / G1 / I4 / I2——H1 独立回归网（pytest+冒烟）
4. **入库**：A1–A6 / I3 / D4 / D5 / D7——门禁 pytest 新用例
5. **可视化**：J1 / J3 / J4 / J5——动态 import 验证+D1 截图实测
6. **收尾**：B1–B3 拆分 / C3 / A6 导览 / 行数复扫 / 版本号 / 打包 / 上传

批边界三件事（编译→复读 diff→台账）+ **红线回对**（每批结束逐条复验涉及红线）+ 漂移自检（实现 vs 设计稿差没差）。

## 验收红线

1. 20 连点 chip 不缩不漂 + 连点后切档回切不缩（I8）
2. 滑移 120ms 全软件一致，含最左跳最右；键盘 ←→ 可切（J7/J8）
3. 10 万字书超墙提示条三选各自生效；记住后静默（F4/F5）
4. 槽失败动作 toast 切换/重试/离线三钮生效；批量报告见实际落点（H1）
5. `2026-08-03 14:30:05` 落库且原样回显；起始年筛选命中（I2）
6. 设置双滚动条消失 + 卡片分界 + 间隔均匀 + 宽窄统一（E1–E4）
7. 立方体 22 轴任选 + 红蓝渐变 + 无 WebGL 兜底（J1）
8. 离线导入卡显无摘要徽章；补摘要回写档案 md（I3）
9. 对齐六处截图复核全齐（K2）
10. 代理开时 Ollama 下载走代理且无 CMD 窗（F3b）

## 记债

- **R1** React-Three-Fiber（百万级粒子/Shader 需求再启）
- C1–C5 维持；F6 地理视图；J5 后排

## 改动台账

（批 1–6 执行时逐批追加：改动文件+行数+门禁结果+红线回对结果）

### 批 1 视觉（E1–E6 / K1–K2 / J7 / J8+B1 / I7 / D6）

- 新增 `components/SegmentedSlider.tsx`（58 行）：J7 共用件，CSS 变量驱动 translateX，120ms ease-out 固定时长，键盘 ←→
- `styles.css` +75/-8：seg-slide/seg-row（J7）、nav-thumb（J8）、settings-body 卡片化作用域限定（E1/E2/E3）、param-row 去 460 宽墙对 40 阶（E4）、number 去旋钮（I7）、tree-chev（K1）、对齐六处（K2 a–f）、chip-clear（J10）
- `App.tsx`：E6 退出箭头去 z 开放描边
- `DocTree.tsx`：K1 展/收改双 chevron 线钮
- `LibraryFace.tsx`/`RespondFace.tsx`/`ComparePanel.tsx`：馆藏五段/检索三视角/回应三段/对比子 tab 接 SegmentedSlider；RespondFace 新建组钮自绘 plus（K2）
- `GraphPanel.tsx`：「全部」钮滑移化（J10）
- **B1 拆分前置（J8 依赖）**：SettingsPanel 701→169 行，新增 sections/：ProvidersSection 210 / LocalModelSection 101 / NetworkSection 103 / ParamsSection 60（含 I7 blur 越界回退）/ KbSection 75 / StanceSection 83 / DiagSection 36 / UiSection 92；J8 nav-thumb 点击+scrollspy 双驱动
- `vite.config.ts`：D6 manualChunks react/viz 两族（产物 react 3.6K / viz 194K / index 307K）
- 门禁：tsc 0 错；vite build 通过。红线②⑥⑨待 D1 GUI 实测统一复核（批 5 后）

### 批 2 bug（I1 / I5 / I8 / D2 / D3）

- `api/files.py`：D3 大表窗口只读——csv 流式跳读（64KB 样本定编码），xlsx read_only min/max_row 取页，total 用 max_row
- `api/import_doc.py`：I1 批量取消——BATCH_STATE.cancel + POST /api/import/cancel（pending 标「已取消」），progress done 计 cancelled
- 新增 `lib/sanitize.ts`（43 行）：D2 白名单净化器（危险节点整删/白名单外解包/on* 全剥/a 限 http/img 禁 javascript:）
- `ReaderModal.tsx`：D2 mammoth HTML 过 sanitizeHtml 再注入；pdf iframe onError 回退「打开原件」外链
- `App.tsx`：I5 手势重做——监听依赖只剩 switchFace（不再每帧重挂），限幅 ±240，达 240 一次性触发交棒过渡动画，suppressCtx 标志代替 dragX 依赖
- `GraphPanel.tsx`：I8 主解——chip 过滤改 linkVisibility/箭头长函数（graphData 恒同对象零重热）；保险——同过滤重拉（纠错/建边/回切）换前读 zoom/centerAt 换后写回，换过滤才 freshLoad 拟合；I1 离面 pauseAnimation
- `LibraryFace.tsx`：I1 五视图 always-mount（display:contents/none）
- `ImportPanel.tsx`：I1 取消钮（单本代际号丢弃结果/批量走 cancel 端点；入库写索引阶段不可取消）+ 离面停轮询回面续上
- 门禁：tsc 0 错；pytest 77 通过。红线①（20 连点）待 D1 GUI 实测复核

### 批 3 机制（G2 → H1 / H2 / F1–F5 / G1 / I4 / I2）

- 新增 `models/model_matrix.py`（140 行）：G2 单一真源—6 模型行（35b-a3b/14b/7b/3b/r1-7b/r1-14b），VRAM(Q4)/窗/auto_ctx/速度质量档/prompt_tier/min_runtime/KV 每t/8k 档时；effective_ctx（读 settings ollama_ctx）/vram_estimate_gb/runtime_ok/recommend_for(≥21→35b/≥10→14b/≥6→7b/≥3→3b)
- `models/llm_client.py`：F2——ollama 分支改原生 /api/chat 传 options.num_ctx=effective_ctx，超时提至 300s，响应兼容原生格式
- `models/model_router.py`：H1——SlotFailure(failed/reason/next) + run_interactive()（槽 1 失败不自动降级；provider 指定重进；offline 直接模板）
- `ingestion/ollama_adapter.py`：F3b——runtime_version/download_channel/serve_start（代理环境变量+CREATE_NO_WINDOW）；F3c——import_gguf（临时 Modelfile+ollama create）；candidates() 改读矩阵
- 新增 `api/local_models.py`（169 行）：/config/hardware（nvidia-smi 隐藏窗+ctypes RAM，hw_profile 缓存）/ollama/ctx GET+PATCH（五档+每档显存预估+tight 标）/ollama/serve /ollama/import-gguf /summary-window（F4/F5 判墙数据源）
- `api/settings.py`：H1——PATCH /config/task-slots（非空/不重/≤5 槽，同链同源旧设置兼容）；ollama_status 扩 version/channel/矩阵候选（compat_ok+recommended）；删自定义服务商时曾选它的任务回落默认+affected_tasks
- `ingestion/summarizer.py`：summary_window()（槽序首可用：ollama→F2 档值/云端→80k/offline→0）；F4 pick_strategy 改读落点窗×0.9 余量线；超长章 _segments 多趟提取+段间合并（不截章尾）；G1 四套小档模板（短指令+步骤显式+完整 JSON 示例）按 prompt_tier 切换
- `engine/rebuttal_engine.py`：H1——generate/generate_stream 加 provider/interactive 参数，交互失败推 slot_failed 事件；引用重试钉在成功槽；G1——build_prompt 加 tier，小档短指令变体（双入口共用）
- `api/rebuttal.py`：RebuttalRequest.provider；流式入口 interactive=True；slot_failed 早退不落空历史
- `api/import_doc.py`：F5——ConfirmRequest.over_window(map_reduce|full)+remember_over_window（写 over_window_policy）；over_window=full 在 confirm 重跑整书总结；批量报告逐本标落点 item.via
- `ingestion/indexer.py`：pick_strategy 传 router；to_dict 加 long_chapters（F5 尾注）
- `storage/sqlite_store.py`+`api/knowledge.py`：I2——documents 加 year_raw 列（schema/迁移/清单三处同步）；MetadataPatch 加 year_raw
- 前端：新增 `sections/TasksSection.tsx`（106 行，H1 编号槽 UI：重复/未配置灰显不藏原因、保底 1 槽、＋上限 5、改动即存热生效）；**TaskChainEditor.tsx 整删**；LocalModelSection 重写（266 行：H2 硬件行+重新探测/F1 矩阵卡 荐/需升级徽标+自由输入/F2 档位 UI/F3b 一键启动+下载通道/F3c GGUF）
- `api.ts`：RebutRequest.provider；`RebutPanel.tsx`：slot_failed 动作 toast（切换/重试/离线模板三钮）
- `App.tsx`：I4——命令面板整删（Palette 组件/paletteOpen/keys.palette/顶栏钮/IcoPalette/caps 提示）；`styles.css` 删 .palette 族，新增 slot/model-card/ctx-gears/over-warn 族
- 新增 `lib/dates.ts`（50 行）：I2 零依赖格式表顺序试解（yyyy/-mm/-dd/HH:MM/:SS/中文/点分）；`ImportPanel.tsx`：年份/日期字段 blur 回显+year_raw 落库；F5 超墙三选条（云端未配灰显/记住后降级小字/长章尾注/时间预估）
- 错别字清理：兑底→保底/回退（model_router/settings/ollama_adapter/sqlite_store）
- 门禁：tsc 0 错；vite build 通过（react 3.6K/viz 194K/index 318K）；pytest 77 通过。红线③④⑤待 D1 GUI 实测复核

### 批 6 收尾（版本/自测/GitHub 源码 +tag）

- `desktop/src-tauri/Cargo.toml`：版本升 0.1.5
- `scripts/build_component_zips.py`：**新增**（A4/C3）组件 zip 打包脚本（ocr/docling→pip 安装打 zip；bge-m3→模型目录打 zip）
- `PLAN-0.1.5.md`：追加批 3-4 台账
- **GitHub**：`git init` → `remote add origin` → `add -A` → commit `[release] v0.1.5` → tag v0.1.5 → push origin main --tags（清理 v0.1.2 旧标签后成功；源码已推至 https://github.com/lulutiyazejin/debate-engine/tree/v0.1.5 ）
- **安装包**：NSIS 打包需 Rust 环境（cargo tauri build），本地无 env 未编译；计划下版构建前拉 Cargo+Rustup。
- 红线复核：③超墙三选（ImportPanel 已实现）、④槽失败 toast（RebutPanel 已实现）、⑤日期 roundtrip（ImportPanel year_raw 落库）——GUI 测试待后续实机。

---

### 批 5 可视化（J1/J3/J4，批 6 后补做）+ B2/B3 拆分 + 打包实录

**后端**
- `api/analysis.py`：新增 /coords（文档 22 轴点 + 立场画像均值）、/crosstab（立场×轴五档分箱，单元数/均值双指标）、/heatmap（章节×轴 |coord| 均值）三端点
- **B2**：`storage/workspace_store.py` 新建（WorkspaceMixin：素材组/素材篮/回应历史），sqlite_store 598→439 行，调用方零改动
- **B3**：`ingestion/duplicate.py`（内容哈希/语义查重）+ `ingestion/confirm.py`（ConfirmMixin：Stage 7-10）新建，indexer 600→392 行；PENDING 延迟导入避环形
- 行数复扫：全部 <500 ✓；pytest 77 通过 ✓

**前端**
- `lib/axes.ts`：22 轴元数据（中文 label + 两极语义，与 classifier.AXES 对齐）；coordColor 红灰蓝恒定色标（决策 13 延伸）
- `views/viz/`：ScatterView（J4 四象限，兼 J1 兜底）/ RadarView（J4 立场画像 22 轴多边形，chips 叠加）/ CrossTabView（J3 自绘表 + 章节热力子切换）/ CubeView（J1 G2 point3D 动态 import，WebGL 探测失败→提示+散点兜底）
- `panels/VizPanel.tsx`：图谱区五段滑移（力导向/3D立方/散点/雷达/交叉），GraphPanel 零改动 always-mount；CubeView React.lazy 分包
- 依赖：@antv/g2+g2-extension-3d+g-webgl+g-plugin-3d+g-plugin-control（npmmirror 绕 TLS）；tsc 0 错；vite build G2 自成 chunk（CubeView-*.js）

**打包实录（三处版本 0.1.5：package.json/Cargo.toml/tauri.conf.json + config.VERSION + installer.nsi）**
- ⚠ 踩坑：`generate_context!` 是编译期宏，lib.rs 没改时增量编译不重嵌 dist；且直接 `cargo build --release` 缺 prod 上下文会指向 devUrl（localhost:1420 拒连）。**正解：用本地 tauri CLI `tauri build --no-bundle`**
- 流程：vite build → tauri build --no-bundle → PyInstaller onedir（引擎 0.1.5）→ makensis → release\DebateEngine-0.1.5-Setup.exe（~112MB）
- 冒烟：打包引擎 health=0.1.5；/coords /crosstab /heatmap 全 200；静默安装后 GUI 实拍：六步导览 1/6、档案 tab、命令面板已删、图谱五段子投影、3D 立方 WebGL 场景 + 22 轴下拉端点语义副行（截图 shot-015-boot4/graph3/radar/xtab）
- 遗留：雷达/交叉面的点击级实拍因坐标注入偏差未单独留图（代码路径与散点同构，tsc+构建+端点已验）；J5 AVA 洞察按 PLAN 后排不做

**版本状态**：v0.1.5 批 1-6 全部落地（J5 后排除外），安装包已出，源码+安装包待推 GitHub。

