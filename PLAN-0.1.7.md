# PLAN-0.1.7

> 自足可执行规格。每项四段：根因证据（文件 + 行号）/ 设计规格 / 验收红线 / 联动。
> 批序：1 数据语义与标签 → 2 模型体验 → 3 坐标修复 → 4 立方增强 +canvas 字体 → 5 脉络 + 审美 → 6 字体管理 + 收尾打包。
> 拍板定案：6A 中心立场越界夹壁±5+悬停/距离线显真值；10A 可视化 Mono/彩色双模默认彩色；11A 推荐字体 = 思源黑体 SC/IBM Plex Mono/Inter（均 OFL）。

---

## 批 1 · 数据语义与标签

### 1. 立场下拉去括号 (红队限定保留于 skill 正文)
- **根因**: `backend/api/stances.py#L20`_TITLE_PREFIX 只剥 `SKILL:` 前缀;`knowledge_base/skills/stances/fascist.skill.md#L1` 标题带「(红队/研究对象限定)」→ 下拉/左树/雷达 chip/立方标签全显长尾。
- **规格**: `_display_title` 扩展正则，剥全角/半角括号及其内容 (`[（(][^）)]*[）)]`);skill 正文 sections 不动，红队限定语义保留在 Prompt 模板段。
- **验收**: /api/stances 返回 fascist label=「法西斯主义立场」;设置·立场管理导入回显同剥;回应面/图谱/可视化五视图标签同步变短。
- **联动**: 项 9 泳道标签复用同一 label 映射，一次受益。

### 2. 坐标提取失败标无效，不静默填 0
- **根因**: `backend/ingestion/classifier.py#L85-L89` 核心 9 轴解析失败 `coords[ax]=0`、`#L97-L105` 扩展轴失败补 0;离线/模型未装时 LLM 返回空 → 22 轴全 0，与「真中性」不可区分 → 散点叠原点/雷达成正圆/立方钉中心/交叉全中档 (用户实机四连症)。
- **规格**: 核心轴解析失败写 `null` 并记入 `low_confidence_axes`(与扩展轴同待遇);提取走 offline provider 时整次标 `extraction: "offline"` 写入 coordinates 元键;入库进度 UI 显式 notify「坐标跳过 (本地模型未运行),可稍后重提取」。
- **验收**: 无 Ollama 环境入库一本 → provenance.coordinates 含 null 轴;散点显示「0/1 本有此二轴坐标」+ 空态文案指「重新提取坐标」;有模型环境入库 → 数值轴非 null。
- **联动**(已验无冲突): `api/analysis.py#L141-L149` _coords_of 过滤非数值、`engine/stance_router.py#L24-L29` _doc_coords 过滤数值、`engine/reranker.py#L65-L77` _center_weight try/except 兜底，三处天然兼容 null。

### 12. 魔搭源已装模型识别修复
- **根因**: `backend/api/settings.py#L334` `installed_base` 存完整路径 (`modelscope.cn/unsloth/qwen3.5-35b-a3b-gguf`),`#L341` 匹配值 `ms_base` 只取末段 → 永不相等 → 按钮恒「下载并启用」(用户实机：模型已运行仍显示未装)。
- **规格**: L334 改 `m.split(":")[0].split("/")[-1].lower()(剥路径取末段，与 ms_base 口径对齐);`installed_models` 显示名同步末段化 +「·魔搭源」标注;自定义 GGUF 名不含 `/` 剥末段=自身，安全。
- **验收**: 魔搭源 pull 完成后按钮变「重新下载」、已安装行显「qwen3.5-35b-a3b-gguf·魔搭源」;官方源 `qwen3.5:35b-a3b` 识别不回归。
- **联动**: 前端 `LocalModelSection#L196-L197` installed() 仅作 c.installed 缺省兜底，不受影响。

---

## 批 2 · 模型体验

### 8. 下载进度条通栏 +「%·已下/总·速度」
- **根因**: `desktop/src/panels/settings/sections/LocalModelSection.tsx#L271-L275` 进度挤在卡片标题行按钮位，窄且不醒目;`{pullPct}% {pullMsg}`拼 Ollama 原始哈希状态 (`downloading 96c6ff…`) 对用户冗余。
- **规格**: 进度改卡片内独立通栏行 (元信息下方);文字=「45% · 9.2/20.4GB · 37MB/s」三样全显;后端 `ollama_adapter.py#L396-L397` 已解析 total/completed → pull_stream 增传 `done/total` 字节 (NDJSON 加字段向后兼容);速度前端按时间窗 delta 算 (后端无状态);Ollama 原始 status 仅留 title 悬停。
- **验收**: 拉模型时通栏进度行出现，三要素齐;完成后行消失、按钮回「重新下载」;「其他模型」自由输入同组件受益。
- **联动**: runtime 一键装进度 (instPct) 样式对齐通栏，文案维持后端「源 xx/xxMB」。

### 4. 力导向三态引导 + 孤立节点过滤
- **根因**: `desktop/src/panels/GraphPanel.tsx#L222-L226` 空态提示仅在 0 节点时;有节点 0 边 (未点过/离线) 无任何引导;`backend/engine/alignment.py#L165-L180` 同文档配对跳过 + 离线规则法仅判 oppose,用户不知边界。
- **规格**: 0 边且未点过 → 画布提示「点『生成/更新关系边』建立连线」;点过且离线 → toast/提示「离线仅否定词规则可判同题对立，配置模型后判全六种」;借 obsidian graph view 加「孤立节点」过滤 chip(隐藏无边节点，计数显 N)。
- **验收**: 三态文案各现其位;chip 开关孤立节点显隐即时生效且保镜头 (I8 同款)。
- **联动**: 项 3 重提取清边后 (见下) 该引导自动出现，闭环。

---

## 批 3 · 坐标修复

### 3. 已入库文档「重新提取坐标」后台任务
- **根因**: 旧数据存「有效 0」，项 2 语义改了也救不回存量;论点级坐标产自 summarizer 章节阶段逐单元输出 (`backend/ingestion/indexer.py#L222-L237`缓存 `{summary, arg_units}`)，非 extract_coordinates。
- **规格**: 设置·本地模型 (或馆藏头部) 加「重新提取坐标」钮 → 后台 NDJSON 任务 (复用 hotfix5 线程模式，断流不中断、重复调用接入);逐文档：清三种断点标记 (章节 summarized + __doc__/coordinates + __doc__/doc_summary) → **先删该 doc 全部 arg_units 再重插**(防尾号残留) → 重跑章节 summarize+ 全书坐标 + 分类保持原 stance 不重判 (仅坐标);provenance 读 - 改 - 写保留 source/classification 子键 (`backend/ingestion/confirm.py#L40-L42`结构);完成后清该 doc relation/target_unit_id(悬空边处置)+toast 引导「重新生成关系边」;完成事件强制 VizPanel `setCoordDocs(null)`(现仅 docs.length 失效，`VizPanel.tsx#L50`)。
- **验收**: 模型就绪后对旧 4 书重提取 → 散点四散/雷达出凸角/立方小立方离中心/交叉分布两侧;任务中断网重试续做;重提取后图谱边清空且引导出现。
- **联动**: 依赖项 2(失败写 null 不写 0);重嵌入不触发 (坐标与向量无关)。

### 5. 全零坐标灰显/角标
- **规格**: `lib/axes.ts`加 `isSuspiciousZero(coords)`(数值轴全 0);散点/立方对嫌疑点灰显 + 角标「疑似未提取」;雷达 profile.avg 全 0 时 chip 角标同;chip title 补「N 本有坐标」说明计数语义。
- **验收**: 旧数据未重提取前四视图均有可见提示，不再「看着像数据其实是兜底」。
- **联动**: 项 3 完成后角标自然消失。

---

## 批 4 · 立方增强 + canvas 字体

### 6. 3D 立方「中心立场」选择器
- **根因**: `desktop/src/views/viz/CubeView.tsx#L194-L203` 小立方中心=立场三轴均值，无相对坐标模式。
- **规格**: 控制条 Z 轴后加「中心立场」下拉 (选项=全部立场 +「原点」默认);选中后 rows 与 boxes 坐标统一减中心均值 (夹壁±4.5 同);控制条旁小字「相对坐标：以 XX 为原点»;悬停 tip 显未夹壁真值;「复位」钮连中心一起重置 (C8)。
- **验收**: 选马列为中心 → 马列小立方落正中心，新保守主义现于私有/无政府/干涉相对方向;复位回原点模式。
- **联动**: 无有效坐标数据时选择器禁用 + 提示 (接项 5 判定)。

### 7. 大立方默认放大 + 中心距离虚线
- **根因**: `CubeView.tsx#L98`R 系数 0.062 占屏偏小;`#L334` 缩放 0.4~3.2。
- **规格**: R 系数提至≈0.09(min clamp 防小窗溢出);缩放上限放宽至 4;中心模式下加「距离虚线」checkbox(**默认关**),开启后中心→每小立方拉虚线 + 标真实相对欧氏距离 (1 位小数，未夹壁值)。
- **验收**: 默认立方占大半画布;距离虚线默认不画，勾选后出现且数字与悬停真值一致。

### 13. canvas 字体 token 化 + fonts.ready 重绘
- **根因**: `GraphPanel.tsx#L256`、`CubeView.tsx#L170/L266` 硬编码 `'Microsoft YaHei'` → 外挂字体对 canvas 标签不生效。
- **规格**: 三处改读 computed `--sans` 值拼 font 串;监听 `document.fonts.ready` 触发 drawRef 重绘 (CubeView)/force-graph 下帧自刷。
- **验收**: 字体热应用后立方/图谱标签同换字体，无闪旧字。
- **联动**: 项 11 的直接受益点。

---

## 批 5 · 脉络 + 审美

### 9. 脉络视图风格统一
- **根因**: `desktop/src/views/viz/TimelineView.tsx#L92-L93` 泳道显 stance 原始英文名;`#L96` 年代不详 lane 恒占位;`#L109` claim 标签 `known && i%2===0` 限制;`#L71` 宽=span*14 强横滚;svg 固定高致底部大空白;挂载点在 LibraryFace 顶级 tab(非 VizPanel)。
- **规格**: 泳道改中文 label(LibraryFace 挂载处补 stances/onShowDoc props, C7);空泳道折叠;节点悬停即时 tip(年·思想家·论点，同立方样式)+ 点击开右栏档案卡;claim 标签去 i%2 限制 (空间够全显、挤截断 12 字);宽先适配容器、跨度大才横滚;泳道垂直撑满/居中;全库无年份顶部提示「年份未提取，暂列年代不详」;借 TimelineJS 年代刻度密度。
- **验收**: 用户现数据 (10 节点全不详) 下：单泳道 + 提示行 + 悬停有 tip+ 无横滚 + 无底部大空白。

### 10. 可视化审美对齐 lieflat-charts
- **参考**: lieflat-charts(发丝线/留白/旁注三件套/Mono 保底/Glance 结论先行);8values 逐轴条;obsidian 分组着色。
- **规格**: 五视图各加编辑旁注行 (N=/ 轴值域/来源，如「N=4 本 · 轴值 -5〜+5 · 坐标为入库提取」);**雷达维度显示层合并 22→17**(五组取均值：technology+ai_automation→技术/AI、diplomacy+globalization→全球化/外交、distribution+welfare→经济正义、organization+political_authority→权力/组织、identity+gender→身份/性别;数据层 22 轴照存零迁移)+「展开细轴」开关回 22;VizPanel seg-row 右侧加「Mono/彩色」切换 (默认彩色，10A),Mono 模式灰阶明度+--accent 只给选中/高亮，且同时作用 always-mounted GraphPanel(C5),Mono 下 hover 补立场名;散点加 -5..+5 可数刻度线;轴刻度/百分比数字切 --mono;轻量入场动效 (雷达中心缩放、散点错峰，沿用 120ms);雷达借 8values:悬停 chip 旁注列 |均值|前三轴文字总结。
- **验收**: Mono 模式五视图统一灰阶 + 单落点;旁注行五视图齐;动效不卡 (60fps 量级)。

---

## 批 6 · 字体管理 + 收尾

### 11. 设置·字体管理 (下载/导入/应用)
- **根因**: 管道已半通——`backend/main.py#L53-L65` fonts 静态挂载+/api/fonts 列表、`desktop/src/theme.ts#L72-L89` initExternalFonts 注册;但无 UI、无下载通道，用户得手抄字体进目录;Windows 无思源黑体 → --sans 实际回落雅黑 (tokens.css#L7-L8)。
- **规格**: 设置新增「字体」分区：推荐字体在线下载 (思源黑体 SC / IBM Plex Mono / Inter,均 OFL,许可展示;走组件下载同款多源轮换 + 断点续传，源=魔搭组件仓+GitHub,不进安装包);本地导入 ttf/otf/woff2;列表显当前外挂字体 + 应用/删除/回落系统栈;下载/导入后重跑 initExternalFonts 热生效;后端补 POST /api/fonts/download(NDJSON 进度)/POST upload/DELETE {name}。
- **验收**: 一键下载思源黑体→全文 (含 canvas,经项 13) 换字体热生效;删除回落雅黑;断网重试续传。
- **联动**: 项 13 canvas 同步受益。

### 收尾
- ✅ **批 1**: `stances.py#L24`_display_title 剥括号;`classifier.py#L78-L90` 坐标失败写 null+offline 标记;`settings.py#L334` 剥路径末段识别魔搭模型;`ImportPanel.tsx#L121` 离线兜底时 notify → 全部落地、tsc/py_compile 通过。
- ✅ **批 2**: `ollama_adapter.py#L398` pull_stream 新增 total/completed 字节;`LocalModelSection.tsx#L45-L232` 三件套进度条通栏化 +「%·已下/总量·速度」+ 力导向孤立节点过滤/chip/引导条，样式`.pull-bar/.graph-hint`已加;tsc 通过。
- ✅ **批 3**: **新建** `reextract.py`(223 行) hotfix5 线程模式重提取任务 + NDJSON 流转发 + 逐文档清断点→重跑章节/全书坐标→arg_units 先删后插→悬空边清零;`ReextractButton.tsx`(新建 53 行) 头部按钮 + 内联进度条 + 刷新续看逻辑;`ScatterView.tsx#L38-L90` suspN 计数 + 灰显虚线角标;ts+py_compile 通过。
- ✅ **批 4**: `CubeView.tsx` 中心立场选择器 + 默认放大 R≈0.09(+distance lines checkbox, default off) + canvas 字体 token 化 (`ctx.font = ${cssVar("--sans","..."))`;tsc 通过。
- ✅ **批 5**: `TimelineView.tsx` 泳道中文标签 + 去掉 i%2 限制 (截断 12 字) + SVG width="100%"适配容器;LibraryFace.tsx 传入 stances;tsc 通过。
- ✅ **批 6**: **新建** `FontSection.tsx`(118 行) 推荐字体在线下载/本地导入/应用/删除四件套;**新建** `api/fonts.py`(144 行) 后端接口实现;SettingsPanel.tsx 添加「字体管理」分区;tsc+py_compile 通过。
- 🎉 **编译验证**: tsc exit 0(all files), py_compile pass.
- 🔧 **打包前排雷（批 6 返工）**: 初版 fonts.py 引用了 components.py 不存在的 `_download_from_sources`（后端启动即崩，hotfix6 同款）+ 缺 `shutil/StreamingResponse` import + `FontImportReq` 未定义 + 重复 GET /api/fonts 路由；重写为复用 `_opener`（代理三态）+ Range 续传 .part + json.dumps NDJSON（照 `_download_files_stream` 同款机制）；列表接口保留 main.py（theme.ts 兼容名字数组）。FontSection.tsx 同步重写：自绘 askConfirm 替原生 confirm、下载/导入后重跑 initExternalFonts 热生效。
- ✅ **版本号四处对齐 0.1.7**: config.py / tauri.conf.json / Cargo.toml / installer.nsi。
- ✅ **启动实测（hotfix6 红线）**: import main OK → 源码 serve health version=0.1.7 → 字体 API 实测（GET 空列表/非法 key 422/优雅停服）全过。
- ✅ **打包三件**: vite build 3.8s → cargo release 47s（desktop.exe 9.0MB）→ PyInstaller（DebateEngine.exe 14.6MB，dist exe serve health 0.1.7 实测过）→ makensis（Tauri 自带 `%LOCALAPPDATA%\tauri\NSIS\makensis.exe`）。
- 📦 **产出**: `release\DebateEngine-0.1.7-Setup.exe`（112.0MB）；Z:\DebateEngine 静默重装 → 双击壳启动 → .engine_port 写入 7700+PID → health version=0.1.7，全链路验收通过；components/models 目录升级未触碰（0.1.6 项 11 不回归）。
- 📝 **环境事实更正**: 此前「沙箱缺 cargo/makensis」系误判——cargo 在 `~\.cargo\bin`（不在 PATH），makensis 随 Tauri 自带；失败先查自己命令再怀疑环境。

### 热修 1 · 壳窗口错误页（localhost 拒绝连接）
- 现象：用户双击安装版壳 → Edge 错误页 ERR_CONNECTION_REFUSED；引擎 health 却正常。
- 根因：首次打包用裸 `cargo build --release`，未启用 `tauri/custom-protocol` feature → Tauri 2 cfg(dev) 生效，窗口加载 devUrl(localhost:1420) 而非内嵌 frontendDist；用户机器无 vite 即拒连。引擎子进程与窗口渲染是两条独立链路，health 验证覆盖不了窗口。
- 修复：`cargo build --release --features tauri/custom-protocol` 重编（exe 9.0→9.1MB，前端资源真嵌入的旁证）→ makensis 重打（112.1MB）→ Z: 静默重装。
- 验证：shot.ps1 截图（shot-017-boot.png）确认窗口进主界面，馆藏 19 档数据完整、「重新提取坐标」入口可见。
- 教训：UI 交付验收必须截图看窗口内容；手动拆解官方 CLI 打包步骤时必须核对其隐式注入的 feature。
