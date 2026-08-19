# PLAN-0.1.3 · 纸感审美统一 + 无外框 + 元数据全收集 + 本地模型一键

> 版本定位：0.1.3 = 把 v5「功能即形态」纸感审美**全软件落地**（design-preview-frameless.html
> 为目标态截图标准），窗口去外框，元数据全收集 + AI 联网补充，本地模型一键下载，
> 立场体系扩至 17 个。双面骨架（0.1.2）不变，只换皮+补能力。
>
> 设计参照：design-preview-frameless.html（本目录）· 政治罗盘球 wiki（立场源）
> 参考架构：ARCH-debate-engine.md §8.4、ARCH-UI-reference.md §0.6–0.10
> 上版计划：PLAN-0.1.2.md

---

## 已确认决策记录

1. 审美基准 = design-preview-frameless.html；mock 即目标态，验收逐项对照
2. 无外框：decorations:false + 功能条拖动区 + 自绘控制钮 + shadow:true；**贴边分屏失效接受，不记债**
3. 桌面图标 = 侧视平叠四本书（页边/书脊交替、宽窄错落、不旋转），纸白填充+墨线+红书签，固定色 .ico
4. 逻辑链 = 流程图式（方框=论点、箭头带文字标签=关系、自上而下=年代）
5. 交互词汇：160/240/400ms 三档 ease-out；静止零动画；加载呼吸点（唯一持续动效）；stagger 40ms；悬停只调墨色；reduced-motion 归零
6. 字体外挂安装目录 fonts\，不进安装包；设置显状态+重载；报告 HTML 不受影响
7. 图标全自绘线型，禁 emoji、禁现成库
8. 元数据：确认屏展示组=书名/作者/立场/译者/出版社+版次/原著书名+语种；自动组=生卒年/学派；查不到空着；作者认不出默认佚名
9. 作者 AI 辨认走 skill（文件名+标题下方附近行）；离线退文件名规则
10. 联网补充三级：维基(中→英)→百度百科→其他；每级≤3s；只补不盖；**手动标优先**（手动>正文>文件名>网上）；维基连不上显式报告；设置开关默认开
11. 模型区拆两块：凭证区 + 任务-模型映射表（首填默认）
12. 代理三态（不开/系统/自定义）+ **127.0.0.1 bypass** + SSL 降级复用
13. 本地模型一键（Ollama 基）：探测/自动拉起/一键 pull/下载立即生效/多模型并存/零手工配置
14. 立场管理：新建立场 + 手动导入 skill md + 12 个波兰球源 skill 随包预置（已落盘）
15. 窗口记忆：设置开关默认关；开启瞬间回桌面居中， thereafter 记忆
16. 设置软件信息区显版本（config.py 单一来源）+ 构建日期
17. bump 脚本一次改齐三处版本号（config.py / tauri.conf.json / installer.nsi）
18. 诊断区一键连通自测（模型/维基/百科/代理）
19. 批量导入确认屏「本批其余同配置」
20. classify 落离线时确认屏显「未分类·请手选」，不静默预填 empirical

## 26 项目 × 5 批

### 批 A · 内容层（零依赖，已部分预置）
- A1 12 立场 skill（neoliberal/feudal_traditional/chinese_socialism/communitarian/anarchist/fascist/environmentalist/feminist/nationalist/populist/technocrat/keynesian）——**已落盘**，installer 递归打包 skills 目录自动随包
- A2 学派参考表写进 ingestion skill（哲学/政哲/经济/社会/史学学派清单，匹配不上留空）
- A3 ingestion skill 增「作者辨认规则」章节 + 信息源优先级（正文>文件名>网上）
- A4 fascist skill 红线机制（输出附历史证伪注记、种族灭绝辩护拒绝）——已内置于文件

### 批 B · 后端
- B1 元数据 schema：documents 加 translator/publisher/edition/original_title/original_lang/author_years 六列；**三处同改**=CREATE 表+ALTER 旧库迁移+upsert 固定列清单（sqlite_store.py:179-195，防分享包丢字段 L1）
- B2 引用格式还债：gbt7714/apa 补译者/出版社（rebuttal_engine.py:62-68）
- B3 入库预览扩展：预览阶段跑作者辨认+联网补充，返回元数据草稿；离线 classify→「未分类」（llm_client.py:135 行为修正）
- B4 新建 web_enrich.py：wiki zh→en→baike→bing 三级；每级 3s 超时；字段级 manual 标记跳过；结果带 source 与 failure_report
- B5 元数据全字段编辑端点（右键修改）
- B6 代理三态：settings.json proxy 键；httpx 调用统一注入；127.0.0.1/localhost bypass；SSL 降级模式复用
- B7 ollama 适配器：GET :11434 探测→未跑自动拉起→POST /api/pull 流式进度→完成即写 provider_models+task_chains 热生效
- B8 立场管理端点：skill md 上传→落 skills/stances→loader 热加载；列表/删除；**导入校验不静默**（文件名须 \w+、六节名逐字、注入检测命中即报错回显）；界面显示 title 剥 `SKILL: ` 前缀；设置页给导入模板
- B9 诊断端点 /api/diagnostics/connectivity：模型链/维基/百科/代理四项自测
- B10 bump-version.ps1：一参改三处

### 批 C · 前端骨架
- C1 无外框：tauri.conf decorations:false+shadow；capabilities 补 minimize/toggle-maximize/close；功能条 drag-region（仅空白带）；onDoubleClick 最大化；自绘三钮（关闭悬停=唯一红落点）winctl 最高 z-index
- C2 功能条取代悬浮组：应用标+双面 tab+检索框+篮角标(App 层实时)+设置钮+winctl
- C3 五投影常驻挂载+hidden（修切面丢状态；含对比投影输入）
- C4 确认屏：全元数据字段可编辑+立场下拉+「跳过联网」+「本批其余同配置」+呼吸点加载态
- C5 设置新分区：任务映射表/本地模型(进度条+磁盘提示)/代理三态/字体管理/立场管理/窗口记忆/软件信息
- C6 窗口记忆：开关默认关；开=立即居中+ thereafter 启动恢复位置大小

### 批 D · 前端视觉 v5（对照 mock 逐条）
- D1 tokens.css 换 v5 纸感双色板 + caps 字体栈（--mono）
- D2 styles.css 控件发丝线化（1px 边、小圆角、去盒子）
- D3 图谱换 G6 并换皮：立场族=单色多阶(实心/空心/点径)，边粗=权重，邻域高亮，combo 折叠，镜头 400ms 滑近；**禁库默认蓝**
- D4 逻辑链流程图视图（ChainView 重写：主线竖排+侧翼+箭头标签+图例）
- D5 时间轴条码 + 作者活跃期带（可选增强）
- D6 档案卡堆栈（drop-shadow 偏移三层）
- D7 空态单色线描 / toast 发丝细条 / 右键菜单·命令面板·设置浮层 v5 化
- D8 报告 HTML 按 v5 语法重排（零 CDN 不变）
- D9 StatHead 数字滚动 600ms
- D10 交互词汇落地：全部动效取 token 常量；reduced-motion 归零
- D11 桌面图标 .ico：SVG 定稿→纯 Python ICO 编码器兜底生成全尺寸
- D12 字体：引擎 StaticFiles 递 fonts\；前端 FontFace 动态注册；未装静默回退

### 批 E · 回归验收打包
- E1 pytest 全量 + 新测试：元数据迁移/upsert 列同步/联网补充降级/代理 bypass/ollama 接线/立场导入
- E2 **mock 对照验收**：逐面截图 vs mock 语法清单（无粗框/单色+单一落点/caps/留白比/动效时长），不符即修
- E3 回归红线：零 cmd 窗、右键×3、离线引导、旧库 0.1.2 迁移、隐私复验、报告断网可开
- E4 打包 + GitHub 上传（版本完成后一次性，commit 模板 [release] v0.1.3）

## 验收红线

1. 启动即无外框纸面，功能条可拖、双击最大化、三钮可用，设置浮层不遮控制钮
2. 桌面/任务栏图标为四书堆纸白版，16px 不糊
3. 深浅主题全组件无硬编码色残留（grep 禁 hex 白名单制）
4. 逻辑链零门槛读法截图与 mock 同构
5. 元数据确认屏一次过目全字段；维基不通时入库结果显式报告且入库不阻塞
6. 本地模型下载完成 10 秒内任务落点表显示新模型
7. 代理自定义开启时 ollama 本地调用不断（bypass 生效）
8. pytest 全绿 + 0.1.2 旧库无感迁移

## 记债

- 贴边分屏：接受失效，不记债（用户已决）
- 社会达尔文主义/威权资本主义立场：未入预置，可经立场管理手动导入
- 自定义立场颜色/图标高级编辑：不入本版

## 改动台账

### 批 A（预置）
- 12 立场 skill 落盘 knowledge_base/skills/stances/，格式同 liberal.skill.md 六节结构；fascist 带红队限定与历史注记红线

### 批 B（后端，两段完成）
- B1-B4/B6-B7/B10 前段已随 50216f8 落库（schema、citations、web_enrich、config 代理三态、ollama_adapter、bump 脚本）
- B5 `api/knowledge.py`：MetadataPatch + PATCH /docs/{id}/metadata（手动>正文>文件名>网上，manual_fields 累积）
- B6 `api/settings.py`：GET/PATCH /config/proxy（custom 前缀校验 + reset_router）、GET/PATCH /config/web-enrich
- B7 `api/settings.py` + `ingestion/ollama_adapter.py`：/config/ollama/status、/config/ollama/pull NDJSON 流（pull_stream 生成器重写，完成即写 provider_models 热生效）
- B8 `api/stances.py` 重写：validate_stance_md 六节校验（ASCII id [A-Za-z0-9_]+、注入检测）、POST import（写盘→热载→不可解析回滚）、DELETE（17 预置保护）、GET template
- B9 `api/diagnostics.py`：GET /diagnostics/connectivity 四查（模型链/维基/百科/代理），SSL 降级重试

### 批 C（前端骨架）
- C1/C2 `tauri.conf.json` decorations:false+shadow、`capabilities/default.json` +9 窗口权限；`App.tsx` 重写：topbar 拖动区 + face-tabs（篮角标）+ 自绘 1.4px 线型图标（禁 emoji）+ winctl（关钮 hover 唯一红点）+ 双击最大化；悬浮组 JSX/CSS 删除
- C4 `ImportPanel.tsx`：确认屏 meta-grid 八字段可编辑（联网字段带「网」标）、web_enrich 报告展示、确认后 PATCH metadata 落库；doc_type→source_type 修正
- C5 `SettingsPanel.tsx`：新增 本地模型（状态/一键 pull 进度条）、网络与代理（三态+联网补充开关+连通自测表）、立场管理（清单/删除/模板/导入校验）、软件信息（版本经 /api/health）四分区；界面区 +窗口记忆开关、悬浮组开关删除
- C6 `App.tsx`：窗口记忆（localStorage de.winmem/de.winrect，PhysicalPosition/Size 恢复，onMoved/onResized 500ms 去抖保存）

### 批 D（视觉 v5）
- D1 `tokens.css` 皮肤置换：纸感双色板（深 #131313 墨纸 / 浅 #e8e6e1 纸灰）、--sans/--mono、--ease cubic-bezier(.16,1,.3,1)、--topbar-h；token 名不变零消费方破坏
- D2/D10 `styles.css`：topbar/tb-btn/winctl 发丝线控件、--ease 统一、breath 呼吸点（唯一持续动效）
- D4 `ChainView.tsx` 重写：垂直流程图 chain-flow（TOP→BOTTOM=TIME 提示、rel-chip 关系标、图例、节点点击续锚）
- D6 `styles.css`：confirm-card 纸叠层阴影
- D11 `packaging/make_icon.py`：四书堆纸感图标（Pillow 自绘）→ icon.ico/png 全尺寸覆盖
- D12 `main.py` /fonts 静态挂载 + /api/fonts；`theme.ts` initExternalFonts FontFace 注册（knowledge_base/fonts 即放即用）
- D3 记债：图谱保留 ForceGraph2D（已吃 token 色板），G6 迁移入 0.1.4 评估

### 批 E（验收）
- E1 pytest 76 全绿（test_v013.py 12 例：元数据回环/立场校验/代理三态本机直连/ollama 不可达上报/联网开关）；tsc --noEmit 零错误；vite build 通过

