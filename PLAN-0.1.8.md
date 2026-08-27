# PLAN-0.1.8

> 版本主题：批量审核与文档管理、可视化补债、存量加固（编码防御/假嵌入）、回应面体验、四项新功能拓展。
> 收集期：2026-08-22 ~ 08-23（四阶段完成：联动矩阵、可行性自评、换位评审、联网参考、全软件回归体检、写链路冒烟实测）。
> 纪律：批边界三件事（编译/复读 diff/台账）+ 红线回对 + 漂移自检。每项四段：证据/规格/红线/联动；机制项厚、样式项薄。

## 〇、拍板记录（全部已定，实施不再询问）

| 决策点 | 拍板 |
|---|---|
| 项 5 批量审核形态 | A：待审队列（非拦截式弹窗） |
| 待审文档可见性 | **不参与**检索/图谱/脉络/回应素材；馆藏树/中区**灰显+「待审」徽章** |
| 项 10 雷达刻度 | 显示层 0-10（真值 -5..+5 平移；中心 0 边缘 10；数据层不动） |
| 项 13 素材上限 | **完全不限制**，无警示无硬拦 |
| 项 30 选中文字加素材组 | 纳入本版；选中哪段入哪段（摘录+来源） |
| 拓展项 | 项 34/35/36/37/38 全纳入；E3 用户立场自测入候选池 |
| 素材注入语义 | 勾选=注入生成；已选数显示在组头与收边细条 |

## 一、项目清单（42 项，每项四段）

### 族一 · 浮层与右键共用件（地基，批 2）

**G1（项 2）右键菜单溢出窗口外**
- 证据：LibraryFace.tsx L380 `style={{left:menu.x, top:menu.y}}` 裸用鼠标坐标，styles.css L407 `.ctx-menu{position:fixed}` 受 transform 祖先劫持。
- 规格：新建 `desktop/src/components/OverlayMenu.tsx`：createPortal 挂 document.body；渲染后测量菜单尺寸，`x=min(x, vw-w-8)`、`y=min(y, vh-h-8)`；点外关闭=document mousedown 捕获监听（卸载时移除）；菜单项 schema `{key,label,danger?,disabled?,onClick}`；分隔线用 `{key:"-"}`。
- 红线：靠右缘/底缘右键，菜单完整可见；连续右键两处菜单不叠加。
- 联动：G3/G4/Q3/M3/V7/R1 全部走此组件；LibraryFace 现有菜单迁移后删旧实现。

**G2（项 3）阅读器右侧截断**
- 证据：ReaderModal 定位在带 transform 的面容器内，fixed 参照系被劫持致最右截断（用户图 3）。
- 规格：ReaderModal 最外层 createPortal 到 body；AppDialog/toast 同法顺检（如已挂 body 则不动）。
- 红线：任意窗口宽度下阅读器右缘完整；Esc/点遮罩关闭行为不变。
- 联动：与 G1 同一 Portal 模式；N3 高亮层随 ReaderModal 移动。

**G3（项 11）全局自绘右键**
- 证据：App.tsx L240-245 contextmenu 仅手势期间 preventDefault，其余处弹原生浏览器菜单。
- 规格：App 根容器 onContextMenu 统一拦截→OverlayMenu；白名单放行原生：`input/textarea/[contenteditable]`；正文选中态走 G4 菜单；无匹配上下文时显通用菜单（刷新视图/打开设置）。
- 红线：输入框右键仍有系统粘贴；文档/素材/画布右键均为自绘菜单。
- 联动：承载 G4/Q3/M3/V7/R1；与长按右键手势共存（手势滑动距离阈值内不弹菜单，沿用现有 anyOverlayOpen 守卫）。

**G4（项 30）选中文字右键加入素材组**
- 证据：无此功能；basket_add 后端现成（workspace.py L83，item_type 合法值 `chunk|arg_unit|document`，422 实测验证）。
- 规格：window.getSelection().toString() 非空时菜单前置两项：「加入素材组」=POST /api/basket `{item_type:"chunk", ref_id:当前doc_id||"manual", excerpt:选中文本, source:当前文档标题}`→toast「已加入公共素材组」；「复制」=navigator.clipboard.writeText。
- 红线：阅读器/检索结果/档案卡选中均可用；入组后回应面素材列表即时可见（basketVersion 触发刷新）。
- 联动：N3 高亮持久化复用同一选区获取；素材组结构不变。

**G5（项 33）stanceLabel 抽共用**
- 证据：四处重复实现——VizPanel L40 / ImportPanel L248 / DocTree L29 / LibraryFace L75。
- 规格：新建 `desktop/src/lib/stance.ts` 导出 `stanceLabel(key, stances)`，兜底 `label || key || "未分类"`；四处改 import。
- 红线：tsc 0 错误；四处显示行为与改前一致。
- 联动：M1 详细信息视图立场列、M4 弹窗文案同用。

### 族二 · 零风险轻项（批 3）

**Q1（项 1）摘要策略术语通俗化**
- 证据：ImportPanel.tsx L294-298 选项直出内部术语。
- 规格（文案原文）：`auto`=「自动选择」title「按书长自动挑策略」；`map_reduce`=「分章摘要再汇总」title「每章各自总结后合并，长书稳妥」；`refine`=「逐章滚动细化」title「一章章读、边读边改总结，连贯性好但慢」；`full_context`=「整书一次投喂」title「整本直接给模型，需要大窗口」。
- 红线：下拉宽度不溢出；悬停 1s 出提示。
- 联动：设置·生成与检索的同名策略下拉（若有）同步改。

**Q2（项 8）档案库滚动条位置**
- 证据：styles.css L577 `.coll-tree` 无 overflow-y，滚动落在外层中区容器（用户图 5）。
- 规格：`.coll-tree{overflow-y:auto;}` + 高度约束（flex 子项 min-height:0）。
- 红线：档案树超一屏时滚动条贴左栏右缘；中区无第二条滚动条。
- 联动：无。

**Q3（项 9）档案 tab 标题重复两行**
- 证据：ArchiveView.tsx L61-69 md 行与原件行各渲染一行同标题。
- 规格：合并单行=标题+右侧两枚小图标（md 预览/原件）；右键菜单（G1）：「打开原件」「在资源管理器中显示」（Tauri shell open + `explorer /select,路径`）。
- 红线：单行 40px 阶梯；两入口都可达。
- 联动：G1/G3。

**Q4（项 14+15）已选数字挪位**
- 证据：App.tsx L325 顶栏 basketCount 徽章（用户图 9 嫌多余）；组头无已选数（图 10 要求处）。
- 规格：顶栏徽章删除；RespondFace 素材组头行尾加 `已选 {n}`（muted small）。
- 红线：勾选变化即时刷新；收边细条同步显示（R4）。
- 联动：R4 细条徽章同源。

**Q5（项 19）上下文长度分区布局**
- 证据：LocalModelSection.tsx L346-371——radio 与标签被 flex 拉开；`.gear-on` 选中态边框裁掉第二行 `{g.vram_gb}GB`。
- 规格：档位 radio+标签 inline-flex gap:6px、组间 16px；齿轮钮固定两行（第一行 fmtK(ctx)、第二行 em 显 VRAM），padding 撑高、不设固定 height；「其他模型」行按钮对齐 40px 阶梯。
- 红线：选中态文字零裁切；radio 点标签也能选中。
- 联动：s04 代理分区 radio 风格顺手统一。

**Q6（项 21）任务分工 + 号居中**
- 证据：TasksSection.tsx L3 注释「行末＋加槽」，+ 缀在末槽 × 后（用户图 2 嫌"屁股后面"）。
- 规格：+ 钮从槽行摘出，槽组下方整行居中独立按钮「＋ 添加备选」；上限 5 槽时隐藏。
- 红线：加槽后新槽下拉即时可选；保底 1 槽逻辑不动。
- 联动：无。

**Q7（项 22）参数通俗备注**
- 证据：ParamsSection 三行参数无解释（用户图 1）。
- 规格（文案原文）：最终引用条数 Top-K=「AI 回答时最多引用几条资料，越大越全但越啰嗦」；粗检索每路 Top-K=「先海选多少条候选再精挑，越大越准但越慢」；整书投喂 token 上限=「整本书直接喂给模型的长度上限，超出自动改分段」。各为参数行下 muted small 一行。顺手：知识文件分区加「打开 skills 目录」按钮（Tauri shell open）。
- 红线：三行备注齐；打开目录按钮指向数据根 skills。
- 联动：Q1 同族文案审查。

**Q8（项 25）重提取入口归位**
- 证据：audit-01——「重新提取坐标」链接悬浮在中区右侧空白，与谁都不对齐。
- 规格：并入 M1 工具行（见 M1）；此处只销原位置。
- 红线：入口不丢。
- 联动：M1。

### 族三 · 设置与下载任务（批 1/4）

**S1（项 39）LLM 响应编码防御加固（定性修正：原「重大乱码」为误诊）**
- 证据：实测引擎输出 CJK=58 完全正常（curl 原始字节+python utf-8 严格解码）；此前「乱码铁证」实为测量工具 PS5.1 对无 charset JSON 按 Latin-1 解码（教训已入库）。但 httpx `r.json()` 走 text 编码推断，响应头无 charset 时确有猜错风险，属真实隐患。
- 规格：四处改 `json.loads(r.content)`（bytes 直入，RFC 8259 自动 UTF-8）：llm_client.py L116、web_enrich.py L80、settings.py L249、ollama_adapter.py L30（补 import json×3）；llm_client 两处 `r.text[:200]` 错误日志改 `r.content.decode("utf-8","replace")`；main.py FastAPI `default_response_class=UTF8JSONResponse`（media_type 带 charset=utf-8，防老客户端误读）。
- 红线：五类任务各跑一发 CJK≥1（用 curl+python 验，禁 PS 文本链）；py_compile+import main。
- 联动：「坐标全 0」根因与乱码无关，另查（S1b）。

**S1b（新增排查项）坐标全 0 根因**
- 证据：用户库 19 docs 坐标全 0；乱码假设已证伪；生成链路正常。
- 规格：导入测试文档看 preview coordinates 是否非 0→非 0 则定性为「历史提取失败遗留」，用户跑「重新提取坐标」即愈（0.1.7 已有入口），在 M1 工具行提示；仍为 0 则窄读 ideology 提取与解析代码定位。
- 红线：给出结论+复现路径，写入台账。
- 联动：V3 全零引导条文案与结论一致。

**S2（项 40）BGE-M3 嵌入组件化（重大）**
- 证据：health `is_fallback=true`；模型 2.29GB 在 Z:\DebateEngine\models\bge-m3；embedder.py L80-84 `import FlagEmbedding` ImportError 静默回落哈希词袋——语义检索实为词袋近似。
- 规格：① components.py 组件清单加 `bge-embed`（名称「BGE-M3 嵌入引擎"，说明「真语义检索；未装时用词袋近似」，体积约 300MB 依赖），安装流=pip --target EXTRAS_PATH/bge-embed 装 FlagEmbedding（锁 cp312/win_amd64，复用 MinerU 装法），装后 `_post_install` sys.path 注入 + `reset_embedder()`；② 重嵌入接口 POST /api/components/bge-embed/reembed：NDJSON 流走 S3 helper，逐文档重算向量（embedder.name 变更即范围=全库，L54 #hash 后缀设计）；③ 诊断分区加「降级状态一览」表（嵌入器/解析器/OCR/生成兜底：正常绿「在用」/降级黄「词袋近似中，去组件中心安装」）；④ 前端 ComponentsSection 加卡片+装后提示「建议立即重嵌入（N 篇）」按钮。
- 红线：装前后 health.embedder 从 #hash 切换到 bge-m3-v1.5 且 is_fallback=false；重嵌入后 vector count=live docs 数（顺带查清 18≠19 差一）；断流不中断（S3）。
- 联动：S3 helper；验收断言升级（三节 2）；候选池「差一」观察项就地解决。

**S3（项 20）后台任务 helper + MinerU 断流即杀修复**
- 证据：components.py L344-411 同步生成器直连 HTTP 流，pip 长静默→WebView 断流报「TypeError: network error」（用户图 1），L410 `finally: proc.kill()` 断流即杀任务。
- 规格：新建 backend/tasks.py `BgTask`：daemon 线程跑任务体，进度写环形缓冲（seq 递增+threading.Event），HTTP 端点只转发（`GET/POST → 从 last_seq 续读`）；同名任务进行中时新请求接入而非重启；任务注册表 dict[name]。MinerU 安装/字体下载（fonts.py 下载流同病）/S2 重嵌入/M6 合并全部迁移。前端 ndjson 消费断流后 2s 自动重连接续。报错文案：「连接中断，任务仍在后台继续，已自动重连」。
- 红线：安装中杀前端流（模拟断流）后 pip 进程存活、重连能续看进度；取消按钮才真杀任务。
- 联动：S2/M6/S4 字体下载共用；0.1.6 热修 5 模式的正式化。

**S4（项 23）字体已下载状态**
- 证据：用户图 2——NotoSansCJKsc 已装，推荐行仍「一键下载」；FontSection 未与已装列表比对。
- 规格：后端 GET /api/fonts/recommended 返回 `[{key,label,note,file,installed}]`（installed=dest.exists()）；前端推荐行 installed=true 时显「已下载 ✓」+次级钮「重新下载」；重新下载先 DELETE 旧文件再走下载流（绕 exists 短路）。
- 红线：下载完成后不刷新页面状态即变；重新下载真的重新拉取（文件 mtime 更新）。
- 联动：S5 源修复同文件；S3 下载流迁移。

**S5（项 24）IBM Plex Mono 源 404**
- 证据：用户图 3——双源 404；实测 `https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@latest/files/ibm-plex-mono-latin-400-normal.woff2` HTTP 200（14.7KB）。
- 规格：FONT_SOURCES.ibm-plex-mono 换 @fontsource jsDelivr 主源 + `https://unpkg.com/@fontsource/ibm-plex-mono@latest/files/...` 备源；file 名改 .woff2。
- 红线：一键下载成功且热生效（等宽数字用途 latin 子集够用）。
- 联动：S4。

### 族四 · 回应面与素材组（批 5，同文件从下往上改）

**R1（项 12）素材 × 防误触**
- 证据：RespondFace 素材条目行内常驻 ×（用户图 7）。
- 规格：× 删除；右键菜单（G1）「移除出组」→askConfirm「移除这条素材？」。
- 红线：无误触路径；确认后即移除并刷新计数。
- 联动：G1/G3；Q4 计数。

**R2（项 13）取消 20 上限**
- 证据：RespondFace L91-103 硬编码 20 注释「prompt 物理限制」、L171「已选 N/20」；后端 rebuttal.py L34 `material_ids max_length=20`。
- 规格：前端上限/截断/文案全删（显「已选 N」）；后端 Field 去 max_length；顺手全局 grep `max_length=|le=` 对照前端限制清错位。
- 红线：勾 25 条生成请求 422 不再出现。
- 联动：拍板「完全不限制」。

**R3（项 28）无立场选项**
- 证据：RebutPanel L42 stance 状态、L74 默认取 stances[0]；stance="none" 通道现成（L4 注释 stance_free 风格已用）。
- 规格：下拉首项「无立场（日常输出）」value="none"；选中时后端不注入立场 Skill、全库平权检索（现成语义）；默认值改读 localStorage 上次选择；历史列显示兜底「—」已有（L151）。
- 红线：无立场生成的输出无立场腔调字段 stance="none" 入历史。
- 联动：素材注入/页边注不受影响。

**R4（项 29）素材区收边**
- 证据：页边注折叠范式 RespondFace L262-264（sideOpen+「<」弹出钮）；左栏无同款。
- 规格：`leftOpen` 状态（uiPrefs 持久化 key=respLeftOpen）；收起=左栏变 28px 细条：「>」弹出钮+竖排「素材」+已选徽章数。
- 红线：收/展 120ms 过渡；细条徽章与组头数一致；重启记忆。
- 联动：R1 同文件；Q4 徽章同源。

### 族五 · 可视化（批 7）

**V1（项 10）雷达 0-10 刻度**
- 证据：RadarView L43-50 域 -5..+5 `r=((clamp(v)+5)/10)*R`；L77-80 四环无数字（用户图 6）。
- 规格：显示映射 0-10；环线 0/2.5/5/7.5/10 数字只标 12 点方向一条轴；旁注一行「刻度 0-10：0=最左倾/否定端，10=最右倾/肯定端（真值 -5..+5 平移）」。
- 红线：数字不与轴标签重叠；数据层与档案卡真值不动。
- 联动：V6 口径旁注一致；V4 的 17 轴合并同批。

**V2（项 16）立方体太小**
- 证据：CubeView L97 `R=Math.min(W,H)*0.09`（用户图 1 更新后过小）；L262 zoom 上限 3.2。
- 规格：系数 0.09→0.22；zoom 上限 4；min clamp 保留防出画布。
- 红线：默认视角立方组占画布过半；旋转到对角不裁切。
- 联动：V3 标签跟随 R 自适应。

**V3（项 18）标签防重叠 helper + 全零引导**
- 证据：用户补充「名字叠一起→看着像立方体全叠一起」；四视图标签皆裸放。
- 规格：`desktop/src/lib/labelLayout.ts`：输入 `[{x,y,w,h,text}]`，包围盒碰撞→垂直错位（±14px 阶梯）→仍撞则省略号+「+N」聚合标记；聚合点 hover 浮层列全名。全零坐标时画布顶部横幅：「坐标未提取——到馆藏点『重新提取坐标』后这里才有分布」。
- 红线：19 文档同点位时可读出每个名字（hover）；横幅只在全零时出现。
- 联动：CubeView/ScatterView/GraphPanel/TimelineView 四处接入；文案与 S1b 结论一致。

**V4（项 17）交叉分析布局 + 0.1.7 项 10 欠账**
- 证据：用户图 2 布局怪；0.1.7 项 10（Mono/色彩开关、旁注、雷达 17 轴、散点刻度）自认未实现。
- 规格：XTab 控件区一行左对齐（轴选择/开关不再散排）；补齐四欠账：等宽数字 Mono 开关、每图旁注一行（数据来源+口径）、雷达 22→17 轴合并映射表（近义轴合并显示，数据不动）、散点 XY 轴刻度线+数字。
- 红线：0.1.7 项 10 验收原文逐条回对。
- 联动：V1 雷达轴合并共用映射表。

**V5（项 26）脉络三宗罪**
- 证据：audit-08——四空泳道占位；全库无年份仍画 1900-1970 假刻度、12 节点均匀铺开；无提示。
- 规格：空泳道折叠（0 节点不渲染行）；全库年份缺失时不画年代刻度网格，「年代不详」单泳道居中排布；顶部 muted 提示「年份未提取，暂按导入序排列」；claim 标签接 V3。
- 红线：**不回退** 0.1.7 项 9 已达标件（中文泳道名/宽度自适应/12 字截断）；有年份文档≥1 时刻度恢复。
- 联动：V3。

**V6（项 27）档案卡结构化**
- 证据：右栏元数据区直接倾倒 YAML/coordinates JSON 全文（多张巡检截图）。
- 规格：改四行字段（标题/作者/年份/立场，空值显「—」）+折叠区「查看原始数据」（22 轴 JSON 等宽显示）；旁注「坐标为真值 -5..+5；雷达图显示为 0-10 平移」。
- 红线：普通用户首屏不见 JSON；原始数据仍可达。
- 联动：V1 口径；G5 立场名。

**V7（项 34）局部图谱入口**
- 证据：analysis.py L57 `graph(stance, doc_id)` 后端现成；无前端入口。
- 规格：文档右键（G1）+档案卡操作行加「查看此文档关系图」→切力导向视图并带 doc_id 过滤，顶部显「正在查看：<标题> 的关系 · 清除过滤」。
- 红线：过滤态可一键清除回全图。
- 联动：G1/G3；M1 中区右键同菜单。

### 族六 · 馆藏改造与文档管理（批 6/8）

**M1（项 42+41+25）馆藏资源管理器化 + 排序 + 工具行**
- 证据：audit-01 中区大片空白；左树 19 标题全截断（用户图：滚动窄条）；排序无任何入口；「重新提取坐标」悬浮。
- 规格：
  - 中区改文档浏览主区，三态视图右上三小钮（Windows 资源管理器习惯）：图标视图=类型图标(PDF/TXT/MD/网页)+两行标题网格；列表视图=紧凑单列（标题+作者）；详细信息视图=表格列「标题/作者/年份/立场/导入时间」，**点列头排序**（升/降序箭头），列宽可拖；
  - 排序维度（图标/列表视图经工具行下拉）：标题拼音首字母/作者/导入时间/发行年份；
  - 左树=导航过滤器：点立场组过滤中区，点「馆藏」根显全部；文档行点击=中区定位+档案卡；
  - 导入区收为顶部一条（拖拽全中区有效，机制不变）；
  - 工具行（原统计行扩展）：`19 档 · 20 块 · 84 论证 ｜ N 篇待审 ｜ 重新提取坐标 ｜ [视图三钮] [排序下拉]`；
  - uiPrefs 持久化：视图态 libView、排序 libSort；双击=阅读器；中区右键=G1 全家桶（编辑元数据/合并/局部图谱/打开原件/删除）。
- 红线：三态切换即时；列头排序与下拉排序结果一致；空库时中区显导入引导大区（现状保留）；拖拽导入不回退。
- 联动：M2 待审徽章/过滤、M3 右键、Q8 入口、G1、项 41 排序、S1b 提示文案。

**M2（项 5）批量导入待审队列**
- 证据：ImportPanel L1-2——单篇有确认卡，批量 `_run_batch` 直接入库（import_doc.py L102-129）。
- 规格：
  - 后端：documents 加列 `review_status TEXT DEFAULT 'approved'`（迁移脚本照 L142 模式）；批量入库写 `pending`；检索（FTS+向量）、graph_data、timeline、素材来源查询全部过滤 pending；新端点 POST /api/knowledge/docs/{id}/approve（单篇）+ /api/knowledge/approve-all；
  - 前端：馆藏树/中区 pending 文档灰显+「待审」徽章；工具行「N 篇待审」→审核面板：逐篇卡片（复用单篇确认屏：AI 推断立场+摘要+可改立场/元数据）+「通过」「全部通过」+多选批量改立场；
  - 拍板落实：pending 不参与检索/图谱/脉络/回应素材。
- 红线：批量导 3 篇→检索 0 命中→逐一通过→命中恢复；「全部通过」一键清空队列；旧库存量文档迁移后全部 approved。
- 联动：M1 工具行/灰显；拍板①。

**M3（项 6）右键编辑元数据**
- 证据：右键无编辑入口；PATCH /api/knowledge/docs/{id}/metadata 现成（ImportPanel L203 在用）。
- 规格：右键（G1）「编辑元数据」→AppDialog 表单：标题/作者/年份/立场（下拉，G5 取名）；保存 PATCH 后刷新树与档案卡。
- 红线：改立场后左树分组即时迁移；空年份可存。
- 联动：M2 审核卡复用同表单组件；M1 详细信息列即时刷新。

**M4（项 32）删立场下游提示**
- 证据：stances.py L102-111 只删 skill 文件；挂靠文档 stance 悬空后显示裸英文 key（DocTree L30 兜底）。
- 规格：delete_stance 前查 `SELECT COUNT(*) WHERE stance=?`；前端确认弹窗文案：「该立场下有 N 篇文档，删除后它们将显示为未分类。确定删除？」（N=0 时简化为普通确认）。
- 红线：预置立场仍不可删（L104 保护不动）。
- 联动：G5。

**M5（项 31）删除级联补全**
- 证据：sqlite_store.delete_document L438-443 五表级联无 basket/responses；arg_units.relation/target_unit_id 跨文档悬空（alignment.py L177 写入）；graph_data 画边不校验 target 存活。
- 规格：delete_document 内追加——basket：`UPDATE basket SET source = source||'（来源已删）' WHERE ref_id IN (被删文档的 doc_id/chunk/arg_id 集)`（保留摘录可用）；responses：不删，前端历史卡「查看来源」对已删 doc 显示「来源文档已删除」禁跳转；关系边：`UPDATE arg_units SET relation=NULL, target_unit_id=NULL WHERE target_unit_id IN (被删单元)`；graph_data 输出前过滤 target 不存在的边（双保险）。
- 红线：复跑 smoke-writes（修正 item_type=document）——删除后 basket 条目带「来源已删」标注、无幽灵边。
- 联动：M6 合并复用同套引用改写；smoke 脚本更新。

**M6（项 7）文档合并（全清单最高风险，最后实施）**
- 证据：分期文章（如【全球经济第一/二期】）在库内各自为档；无合并能力。
- 规格：
  - 前端：中区多选（Ctrl/Shift）→右键「合并文档…」→对话框：按标题【第 N 期】正则自动预排+拖拽调序+选目标文档（默认第一篇）→「开始合并」；
  - 后端 POST /api/knowledge/merge `{doc_ids:[有序], target_id}`，走 S3 BgTask NDJSON：① 章节/分块按序并入 target（chapter order 重排）；② 源 doc 的 basket/responses 引用改指 target；③ 源 doc 关系边清 NULL（M5 同款）；④ 删源 doc 库记录（archive 原件全保留）；⑤ target 重跑整书摘要+坐标（LLM，进度逐条上报）；
  - 完成 toast+引导「重建关系边可到图谱点生成关系」。
- 红线：合并中断流不中断（S3）；合并后库 stats 自洽（chunks/arg_units 守恒-源 doc 行）；原件在 archive 可寻回；素材组条目指向 target 可跳转。
- 联动：依赖 M5/S3 先行；Calibre EpubMerge 参考模式。

**M7（项 4）孤立节点开关复验**
- 证据：GraphPanel L248-252 「孤立节点」chip 0.1.7 已实现；用户在旧包上报缺失。
- 规格：无代码；批 10 装新包实操复验后销项。
- 红线：开关切换即时显隐孤立点。
- 联动：无。

### 族七 · 新功能拓展（批 9）

**N1（项 35）双立场自动对辩**
- 证据：rebuttal 通道与立场 Skill 齐备（llm_client/rebut 引擎）；无对辩编排。
- 规格：后端 POST /api/debate `{topic, stance_a, stance_b, rounds=3, length?}` NDJSON 流（走 S3）：轮流以对方上轮输出为 argument 调 rebut 引擎（首轮 a 立论=topic），逐轮 emit `{round, side, text}`；前端回应面新增三级 tab「对辩」：议题输入+两立场下拉（复用 stances）+轮数(2-5)+开始；输出双栏左右对排（左 a 右 b），完成后「存为回应历史」（intent="debate"）。
- 红线：中断可重连续看（S3）；每轮 CJK≥1；历史可回看。
- 联动：R3 无立场不可选为对辩方（下拉排除 none）；S3。

**N2（项 36）论点正反树**
- 证据：arg_units.relation（支持/反驳）+target_unit_id 现成；逻辑链现为线性主线。
- 规格：逻辑链提取主线后，对主线每节点查库内 relation 指向它的单元，按 支持/反驳 挂左右两列（Kialo 式 pro/con）；节点卡=单元 claim+来源文档名，点击开档案卡；无关系数据时显提示「先到图谱『生成关系』」。
- 红线：M5 清悬空后无幽灵子节点；两列可折叠。
- 联动：依赖 M5；V3 标签规则。

**N3（项 37）阅读器高亮批注持久化**
- 证据：无此功能；G4 已有选区获取。
- 规格：SQLite 新表 `highlights(id, doc_id, quote TEXT, prefix TEXT, suffix TEXT, color, note, created)`（文本锚点=引文+前后文各 32 字符，重开按文本匹配定位，容错重复取首个）；阅读器选中→浮条「高亮/批注」；已高亮段背景色+hover 显批注；右键高亮可删。
- 红线：重开文档高亮还原；原文轻微变动（重导）时匹配失败静默忽略不崩。
- 联动：G4 选区；M5 删文档级联删 highlights（建表带 ON DELETE 由 delete_document 处理）。

**N4（项 38）Argdown 导出**
- 证据：kb/save-text 接口现成（kb_package.py L70）；论证格式输出结构化（主张/论据）。
- 规格：回应结果卡操作行加「导出 Argdown」：把论证结构转 `[主张]: 文本` + `  + <论据1>: 文本` 语法，save-text 存 .argdown（路径用 Tauri save 对话框）。
- 红线：导出文件 UTF-8、Argdown 语法可被 VSCode 插件解析。
- 联动：无。

## 二、实施批次（防返工排序）

| 批 | 内容 | 依赖 |
|---|---|---|
| 1 | S1 编码加固+main.py charset + S1b 坐标根因排查 + S2 嵌入组件 | 无 |
| 2 | 共用件：G1/G2 OverlayMenu+Portal、V3 labelLayout、S3 BgTask + G5 | 无 |
| 3 | 轻项 Q1-Q7 | 无 |
| 4 | S4/S5 字体 + S3 接入 MinerU/字体流 | 批 2 |
| 5 | 回应面 R4→R2→R1→R3（同文件从下往上） | 批 2 |
| 6 | M1 馆藏改造+M2 待审+M3 元数据+G3/G4 接入+Q8 | 批 2 |
| 7 | 可视化 V1-V7 | 批 2 |
| 8 | M4/M5 删除级联 → M6 合并（最高风险收尾） | 批 2、M5 |
| 9 | 拓展 N1-N4 | M5(N2)、S3(N1) |
| 10 | M7 复验+全量验收+版本四处同步+打包发布 | 全部 |

## 三、全局验收红线

1. 打包管线：vite build → `cargo build --release --features tauri/custom-protocol` → PyInstaller → makensis；版本号四处：config.py / tauri.conf.json / Cargo.toml / installer.nsi。
2. 能力断言：health `is_fallback=false`（装嵌入组件后）；LLM 输出 CJK≥1（**必须 curl+python 验证，禁 PS5.1 文本链**）；py_compile + `import main`。
3. 三脚本每版必跑：audit.ps1（12 屏）、audit2.ps1（13 分区）、smoke-writes.ps1（写链路，item_type 修正为 document）。
4. 全流程实操：批量导入→待审→通过→检索→选中加素材→生成→合并→删除→局部图谱。
5. 窗口截图 shot.ps1 验主界面渲染。
6. 批边界红线回对+漂移自检；版本收尾行数扫描（对照 Software Architecture.md §2）。

## 四、改动台账（逐批追加）

| 批 | 文件 | 改动 | 状态 |
|---|---|---|---|
| 1 | backend/models/llm_client.py | L103/L113 错误日志 decode("utf-8","replace")；L116 改 json.loads(r.content)+注释 | ✅ 已落+复读 |
| 1 | backend/ingestion/web_enrich.py | +import json；L80 改 json.loads(r.content) | ✅ 已落+复读 |
| 1 | backend/api/settings.py | +import json；L249 改 json.loads(r.content) | ✅ 已落+复读 |
| 1 | backend/ingestion/ollama_adapter.py | +import json；L30 改 json.loads(r.content) | ✅ 已落+复读 |
| 1 | backend/main.py | default_response_class=UTF8JSONResponse（charset=utf-8） | ⏳ 进行中 |
| 1 | （定性修正）项 39「重大乱码」为误诊：真凶=PS5.1 客户端 Latin-1 解码；引擎输出实测 CJK=58 正常；S1 降级为防御加固；坐标全 0 假设证伪→立 S1b 另查 | — | 📝 记录 |

## 五、下版候选池（0.1.9 拍板）

- E3 用户立场自测（8values 式）
- 分享包导出/导入流式进度（kb_package.py 同步阻塞，大库白屏）
- dev 纯浏览器无 Tauri 兜底（metadata undefined 崩溃，仅影响开发巡检）
- save-text 路径白名单
