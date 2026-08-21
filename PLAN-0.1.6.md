# PLAN-0.1.6

> 自足可执行规格。每项四段：根因证据（文件+行号）/ 设计规格 / 验收红线 / 联动。
> 批序：1 代理与下载链 → 2 UI 基础 → 3 设置迁移+GGUF → 4 立方自绘+标签常显 → 5 组件资产+独立文件夹 → 6 收尾打包上传。
> 拍板定案：1A bge-m3 走官方源（ModelScope 主+hf-mirror 备）；2A confirm 8 处同批换自定义弹窗。

---

## 批 1 · 代理与下载链

### 1. 模型下载没反应/无进度 + 跟随系统代理无效
- **根因**：
  - `backend/ingestion/ollama_adapter.py#L124-L130` serve_start 仅 custom 模式写代理 env；system 模式指望进程自带——安装版引擎由 Tauri 干净环境拉起，env 必缺 → Ollama 直连失败；
  - 同处 `env["HTTPS_PROXY"]=env["HTTP_PROXY"]=…` 双键同写错误：Ollama 官方 pull 只认 HTTPS_PROXY，HTTP_PROXY 无用且可能干扰客户端连接（docs.ollama.com/faq、ollama issue#6679 实测引用）；
  - `backend/config.py#L232-L245` httpx_proxy_for 在 system 模式返回 None（httpx trust_env 语义），安装版无 env → 全线直连。
- **规格**：
  - 新增 `config.system_proxy_url()`：读注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`，ProxyEnable==1 且 ProxyServer 非空 → 返回 `http://<ProxyServer>`；ProxyServer 空（PAC 脚本模式）→ 返回 None 且一次性 notify「系统代理为脚本模式，本软件无法解析，请在自定义代理手填地址」；非 Windows 回落 env HTTPS_PROXY；
  - `httpx_proxy_for`：system 模式对非本地地址返回 `system_proxy_url()`；`httpx_trust_env_for` 统一返回 False（代理显式传参，语义简化）；
  - serve_start：system 模式把解析值**只写 HTTPS_PROXY 一个键**；custom 不变；off 删键；
  - 下载通道行（LocalModelSection#L160-L165）显示解析后地址；系统未设代理时文案「跟随系统代理（当前系统未设代理=直连）」。
- **验收**：测试机系统代理 127.0.0.1:7890 下，通道行显示该地址；一键启动后 pull 实测走代理出进度。
- **联动**：llm_client/web_enrich/diagnostics/components 同受益；`backend/tests/test_v013.py#L71-L79` 断言同步修正。

### 3. 组件中心 404 + urllib 代理语义错配
- **根因**：
  - `backend/api/components.py#L30-L31` 主源 components-v1 Release 不存在（GitHub API 实测 404），ModelScope 镜像仓库不存在；
  - `#L116-L120` `_opener` 用 urllib 而 system 模式 httpx_proxy_for 返回 None → `ProxyHandler({})` 显式禁代理；
  - `#L174` frozen 不回落 pip。
- **规格**：
  - `_opener` 改吃批 1 解析值（proxy 有则 ProxyHandler({http,https})，无则 ProxyHandler({})）；
  - 失败 toast 带源 URL + HTTP 状态码（区分资产缺失 vs 网络）；
  - ocr/docling 仍走 zip urls，批 5 发布 components-v1 Release（资产仅这两件）；
  - bge-m3 改 files 多文件清单制（见下「bge-m3 官方源专条」）。
- **验收**：装后实测 ocr zip 下载成功；bge-m3 首件 206 续传验证；404 场景 toast 含 URL+状态码。
- **联动**：断点续传 .part 逻辑（#L124-L132）保留；Range 头随 urllib 重定向保留已实测。

#### bge-m3 官方源专条（拍板 1A）
- **files 清单**（HF API 实测，主权重是 pytorch_model.bin，**无** model.safetensors）：
  必备 10 = `pytorch_model.bin`、`config.json`、`config_sentence_transformers.json`、`modules.json`、`sentence_bert_config.json`、`special_tokens_map.json`、`tokenizer.json`、`tokenizer_config.json`、`sentencepiece.bpe.model`、`1_Pooling/config.json`；
  可选 2（默认不下）= `sparse_linear.pt`、`colbert_linear.pt`。
- **源序**：主 `https://modelscope.cn/models/BAAI/bge-m3/resolve/master/<file>`（实测 302→206，Accept-Ranges: bytes，总长 2,271,145,830 B）；备 `https://hf-mirror.com/BAAI/bge-m3/resolve/main/<file>`（实测 308→302→206）。
- **下载器**：逐文件独立 .part + Range 续传；单文件源挂自动换备源续同一文件；完成文件跳过；全文件落齐才 _post_install。
- **验收红线**：批 5 装后环境实测首件 206 + 暂停/续传三连（见项 10）。

---

## 批 2 · UI 基础

### 4. 右键滑动没松右键就切面
- **根因**：`desktop/src/App.tsx#L226` move 越 GESTURE_MAX 立即 fire。
- **规格**：删 move 即时 fire，GESTURE_MAX 仅作视觉上限（dragX clamp 保留）；统一 mouseup 判定（#L236 GESTURE_DONE 保留）；手势期顶部提示条文案「松开切面 · 滑回取消」。
- **验收**：按住越阈不切；滑回松手不切；越阈松手切；三处业务右键菜单不受影响。

### 5. 原生 prompt/confirm 换自定义弹窗（拍板 2A，11 处）
- **根因**：prompt 3 处 `RespondFace.tsx#L110/L117`、`GraphPanel.tsx#L152`；confirm 8 处 `ProvidersSection.tsx#L50/L101`、`GraphPanel.tsx#L140`、`ComponentsSection.tsx#L55`、`LibraryFace.tsx#L183`、`KbSection.tsx#L65`、`StanceSection.tsx#L34`、`DataDirSection.tsx#L68`。
- **规格**：新增共用件 `desktop/src/components/AppDialog.tsx`：
  - `InputDialog({title, initial?, placeholder?, okText?}) → Promise<string|null>`；
  - `ConfirmDialog({title, body, danger?}) → Promise<boolean>`；
  - 纸感 token（var(--bg-1)/--hairline/圆角 10px），Enter=确认、Esc/遮罩点=取消，输入框 autofocus；danger 确认钮红描边。
  - GraphPanel 论点修正 initial=原 claim。
- **验收**：11 处零原生框；新建素材组弹窗实拍纸感。

### 6. 页边注/设置按钮符号与位置
- **根因**：`RespondFace.tsx#L260-L262`「⟩/⟨」在中栏 seg-row（页边注外）；设置退出=红箭头 svg（`App.tsx#L370-L375`）。
- **规格**：收缩钮改「>」移入页边注 aside 内 col-head 右侧；收起后弹出钮「<」留 seg-row 原位；设置退出 svg 改「>」形（开放描边不闭合，strokeWidth 1.4 round cap，path 例 `M5.5 2.5l5.5 5.5-5.5 5.5`）。下刀前 grep 全库 `⟩|❯|→` 一次性统一。
- **验收**：实拍三处符号与位置。

### 12. 任务分工等宽布局
- **根因**：`TasksSection.tsx#L69-L98` 行内流式，select 随内容变宽、换行参差。
- **规格**：`.slot-group` 改 `display:grid; grid-template-columns:repeat(2,1fr); gap:8px`；select `width:100%`；编号 b 定宽 1.2em；×/＋钮定宽 28px 且＋占一格位。
- **验收**：5 槽任务行实拍整齐两列等宽。

### 13. 设置浮层居中
- **根因**：`styles.css#L100-L102` `align-items:flex-start` + `margin-top:4vh` = 垂直贴顶。
- **规格**：`.overlay` 改 `align-items:center`；删 `.overlay-card` 的 margin-top；tour 浮层（同 .overlay 底）同步验不跑偏。
- **验收**：实拍设置卡上下留白对称。

---

## 批 3 · 设置迁移 + GGUF 浏览

### 7. UI 设置迁 settings.json（根治升级丢设置）
- **根因**：`UiSection.tsx#L15-L24`、theme.ts 全存 localStorage（WebView2 档案目录），升级/换档即丢；业务设置 settings.json 跟知识库走能继承（Z 盘实测 settings.json 完好）。
- **规格**：
  - 后端 `GET/PATCH /api/settings/ui_prefs`（浅合并 settings.json 的 ui_prefs 键）；
  - 迁移键：theme、accent_hue、gesture_on、gesture_invert、key_switch、winmem + 新增（cube_invert 默认 1、cube_labels、cube_alpha 默认 18、cube_cols 默认红绿蓝、graph_labels）；
  - 迁移优先级 localStorage 旧值 > 新默认；幂等（后端缺键且本地有值才写，写完不清本地）；
  - theme.ts 首帧仍同步读 localStorage 防闪，挂载后异步对齐后端；
  - 软件信息页加行「设置文件：<SETTINGS_PATH> · 数据根：<KNOWLEDGE_BASE_PATH>」。
- **验收**：模拟升级（清 WebView2 档案目录 %LOCALAPPDATA%\com.debateengine.desktop）后设置不丢。

### 2. GGUF 路径浏览按钮
- **根因**：`LocalModelSection.tsx#L250-L252` 纯文本输入。
- **规格**：输入旁加「浏览」钮，`@tauri-apps/plugin-dialog` 的 `open({multiple:false, filters:[{name:"GGUF",extensions:["gguf"]}]})`；选中回填路径；命名空时默认=文件名去 .gguf、小写、空格→-（符 `GgufImport` pattern `^[A-Za-z0-9._:-]+$` local_models.py#L132-L135）。权限已备（capabilities/default.json#L9 dialog:default 含 allow-open）。
- **验收**：浏览钮弹系统选择、过滤 .gguf、回填+自动命名正确。

---

## 批 4 · 立方自绘 + 标签常显

### 8. 3D 立方弃 G2 改自绘（参照稿 cube-demo.html 移植）
- **根因**：G2 cartesian3D 五固有缺陷实测（放大跳固定镜头/着色不生效且单轴/长方形分格/原点在边界/无半透明立方），用户实拍+我方实测双证。
- **规格**（demo 已验，移植时 UI 一致化）：
  - 零依赖 canvas 2D：旋转矩阵+弱透视 f=80；等比正方分格；原点居中；
  - 大立方=三轴六向渐变场：六面填充 base=固定轴色×(val+5)/10，另两轴色沿各自边线性叠加；**只对面朝视角的三个内壁画方格**（lineWidth 1.0、rgba(90,84,75,.55)），外表面不画；线框恒显；
  - 立场=1×1×1 小立方（half 0.5），中心=该立场文档三轴均值；未分类（stance=""）硬钉 (0,0,0)；
  - 文档圆点=自身坐标，色=场色（三轴自选色加权混合，权重=(坐标+5)/10）；
  - 轴尽头标签=axes.ts neg/pos（公有←→私有/集权←→无政府/反帝←→干涉主义），白描边深字；
  - 立场名公告牌文本（正对屏幕、深度缩放 clamp[10,20]、远→近排序），文=`名 · N`；
  - 控件条（复用 param-row/controls/chk 类+主题变量，深色自动反色，接 viz 行同区）：X/Y/Z 轴取色器（默认 #ff0000/#00ff00/#0000ff）/透明度滑杆 0-90 默认 18/拖动反向默认开/常显标签开关/复位视角钮（含颜色复位）；
  - 交互：拖转（反向开关）、滚轮连续缩放 0.4-3.2、悬停小立方/点显名、点小立方高亮该立场文档；
  - 依赖清理：删 @antv/g2-extension-3d、@antv/g-webgl、@antv/g-plugin-3d、@antv/g-plugin-control（g2 2D 保留给散点/雷达/交叉）。
- **验收**：三角度实拍——小立方不越界、内壁网格不缺面、未分类居中、圆点在小立方内、轴端标签在位。

### 9. 力导向标签常显开关
- **根因**：GraphPanel nodeLabel 仅悬停。
- **规格**：图谱工具行加「常显节点标签」chk（落 ui_prefs）；开=nodeCanvasObject 自绘圆+白描边+claim 截断 12 字+…，字号随 zoom clamp；关=默认。
- **验收**：开开关不悬停全见标签，不糊屏。

---

## 批 5 · 组件资产 + 独立文件夹 + 暂停取消

### 10. 组件下载暂停/取消
- **根因**：`ComponentsSection.tsx#L78-L82` 有进度条无中断钮。
- **规格**：进度条旁加「暂停」「取消」；暂停=AbortController 断流，卡显「已暂停 · X% · [继续]」；取消=断流回「下载并启用」；两者 .part 保留；后端 StreamingResponse 客户端断开自停生成器。ndjsonPost 增 signal 参数。
- **验收红线**：下 30% → 暂停 → 继续 → 取消 → 重下 三连实测续传接续、不从头、不卡钮。

### 11. 模型/组件安装目录独立文件夹
- **根因**：`config.py#L61` EXTRAS_PATH=engine/_extras —— 升级安装整体覆盖 engine 目录，**已装组件会被冲掉**（真 bug）；用户要求独立文件夹。
- **规格**：
  - INSTALL_DIR：frozen=`Path(sys.executable).parent.parent`，dev=PROJECT_ROOT；
  - 组件落 `INSTALL_DIR\components\<name>`；模型落 `INSTALL_DIR\models\bge-m3`；与 knowledge_base 分离；
  - 首启一次性搬移：旧 engine/_extras 子目录、旧 knowledge_base/models/bge-m3 存在且新位置不存在 → shutil.move；
  - BGE_M3_PATH/KB_PATH env 覆盖保留；mount_extras 扫描逻辑不变；installer.nsi 不打包这两目录。
- **验收**：升级安装后已装组件不丢；新装下载落新目录；设置·软件信息显示两路径。

---

## 批 6 · 收尾

- 版本号五处同步 0.1.6（package.json/Cargo.toml/tauri.conf.json/config.py VERSION/installer.nsi）；
- pytest 全绿 + tsc 0 错误（批边界跑）；
- 打包三件：`.\node_modules\.bin\tauri.cmd build --no-bundle`（禁直接 cargo build，记忆 98208c04）→ PyInstaller onedir → makensis；
- Z 盘静默装后 13 项红线回对表逐条实拍；
- GitHub：只传源码（push main + tag v0.1.6，代理 127.0.0.1:7890），Release 页带变更说明，**不传二进制**；components-v1 Release 上传 ocr/docling 两 zip（资产例外，属运行时下载源）。

---

## 改动台账
（每批边界追加：编译结果/复读 diff 摘要/红线回对）

### 批 1 · 代理与下载链（完成）
- config.py：+import sys；+system_proxy_url()（注册表 ProxyEnable/ProxyServer，多协议段取 https/http，PAC 空返 None，非 Win 回落 env）；httpx_proxy_for system 模式返解析值；httpx_trust_env_for 统一 False。
- ollama_adapter.py：serve_start 先清两键再按三态只写 HTTPS_PROXY（custom/system 解析值）；download_channel system 模式显「跟随系统代理 <地址>」或「未设=直连」。
- components.py：_opener 提模块级；bge-m3 改 sources+files 清单制（10 必备件，小文件先大权重后）；+_download_files_stream（逐文件 .part+Range 续传、换备源续同文件、原子改名、全齐才 _post_install）；_state 文件清单完整性判定；失败 detail 带源 URL+状态码；install 路由按 files 分流。
- LocalModelSection.tsx：通道行直显后端 detail。
- test_v013.py：test_system_mode_trusts_env 改 test_system_mode_resolves_registry。
- 编译：pytest 77 passed。红线回对：本地 bypass 保持（测试断言）；通道行真实地址待批 6 装后实拍。

### 批 2 · UI 基础（完成）
- +components/AppDialog.tsx：askInput/askConfirm 命令式 Promise API + DialogHost（Enter 确认/Esc 遮罩取消/autofocus/danger 红描边）。
- 11 处替换完成（RespondFace×3、GraphPanel×2、Providers×2、Components/LibraryFace/Kb/Stance/DataDir 各 1）；grep 验证 window.confirm|window.prompt|⟩|⟨|❯ 全库 0 残留。
- App.tsx：删 fire，move 只跟手（项 4 松手才切）；+手势提示条；设置退出 svg 改「>」chevron；挂 DialogHost。
- RespondFace：收缩钮「>」入页边注 col-head 右侧，收起态弹出钮「<」留 seg-row。
- styles.css：overlay 双居中（项 13）；slot-group 两列等宽 grid（项 12）；+dlg/gesture-hint/side-head 族。
- 编译：tsc --noEmit 0 错误。

### 批 3 · ui_prefs 迁移 + GGUF 浏览（完成）
- settings.py：+GET/PATCH /config/ui-prefs（settings.json ui_prefs 键浅合并，存 localStorage 原始字符串）；+GET /config/paths（settings_path/data_root）。
- +lib/uiPrefs.ts：MAP 11 键（theme/accent/gesture/gesture_invert/keys/winmem/cube_invert/cube_labels/cube_alpha/cube_cols/graph_labels ↔ de.*）；setUiPref 双写（localStorage 即时 + 300ms 去抖 PATCH）；syncUiPrefs 启动同步（后端优先继承，仅本地值一次性迁移，幂等）。
- theme.ts：setThemePref/setAccentHue 改走 setUiPref；UiSection 4 处 localStorage.setItem → setUiPref。
- App.tsx：启动 syncUiPrefs() 后重跑 initTheme()（继承值即时生效）。
- SettingsPanel：软件信息区 +设置文件/数据根真实路径行（升级丢设置排障入口）。
- LocalModelSection：+GGUF 浏览按钮（plugin-dialog open，gguf 过滤，自动命名小写去非法字符）。
- 编译：tsc --noEmit 0 错误；pytest 77 passed。

### 批 4 · 立方自绘 + 力导向标签常显（完成）
- CubeView.tsx 整体重写（视觉基准 cube-demo.html）：零依赖 canvas 2D 弱透视 f=80；大立方三轴 RGB 渐变场（轴色可选，默认红/绿/蓝）；方格只画面朝视角三内壁；立场=1×1×1 小立方（中心=三轴均值夹 ±4.5，未分类硬钉原点）；文档=场色圆点；公告牌文字远→近；轴尽头 neg/pos 名（axes.ts）；拖转/滚轮/悬停 tip/复位；控件复用 controls/chk/param 类+主题 token；偏好 setUiPref（de.cube.cols/alpha/invert/labels，反向默认开、透明度 0-90 默 18）。
- VizPanel：CubeView 改传 stances，删 WebGL 兕底注入；ScatterView 保留独立模式。
- GraphPanel：+「常显节点标签」chk（de.graph.labels），nodeCanvasObjectMode after 叠画论点截 12 字，关闭仍悬停 nodeLabel。
- package.json：删 @antv/g2 / g2-extension-3d / g-webgl / g-plugin-3d / g-plugin-control 五依赖（全库 grep 确认仅旧 CubeView 引用）。
- styles.css：+.cube-cv/.cube-tip/.cube-col 族（token 用 hairline/bg-3/tx-1）。
- 编译：tsc 0 错误；vite build 过，CubeView chunk 9.65 kB（原 3D 链多 MB 包消失）。

### 批 5 · 暂停取消 + 独立文件夹（完成）
- ndjson.ts：ndjsonPost +可选 signal 参数（fetch 透传，断流后端 StreamingResponse 自停生成器）。
- ComponentsSection：下载中进度条旁 +「暂停」「取消」；暂停态卡显「已暂停 · X% · [继续][取消]」；两者 .part 保留，继续/重下都走 Range 续传；AbortController + abortKind ref 区分暂停/取消。
- config.py：+INSTALL_DIR（frozen=exe 上上级，dev=项目根）；MODELS_DIR→INSTALL_DIR/models，EXTRAS_PATH→INSTALL_DIR/components；BGE_M3_PATH 简化（env 覆盖保留）；+migrate_component_dirs()（旧 engine/_extras 子目录、旧数据根 models/bge-m3 一次性 shutil.move，幂等），mount_extras 开头先搬。
- settings.py /config/paths +components_dir/models_dir；SettingsPanel 软件信息 +组件/模型目录两行。
- installer.nsi：安装只覆盖 engine\，两新目录升级天然不触碰；+卸载可选段 UnSecComp（默认保留）。
- 编译：tsc 0 错误（修一处 ref 类型收窄）；pytest 77 passed。

### 批 6 · 收尾（完成，组件资产上传按红线终止）
- 版本五处同步 0.1.6：package.json/Cargo.toml/tauri.conf.json/config.py VERSION/installer.nsi。
- 打包三件：tauri.cmd build --no-bundle（cargo 补 PATH）→ PyInstaller onedir → makensis，release\DebateEngine-0.1.6-Setup.exe 117.6MB。
- Z 盘静默装后实拍：health version=0.1.6；/api/config/paths 组件/模型目录落 Z:\DebateEngine\components|models（项 11 冻结路径解析正确）；ui-prefs PATCH/GET 往返正常（本地旧偏好一次性迁移生效）；shot-016-boot.png 实拍 3D 立方自绘（渐变场/内壁方格/轴名/立场小立方+常显标签/控件条全在）。
- GitHub 源码上传：push main（e64bca8..72ee448）✓；tag v0.1.6 ✓；Release v0.1.6 带变更说明 ✓（id 373916843）。
- components-v1 资产（ocr/docling zip）：本地构建 ocr-win64.zip 107MB；上传连续 5 次失败（代理断大文件 POST，curl 56 schannel close_notify；直连则吊销检查不过）→ 按用户红线终止，留待手动上传；release 页 starter 残包已随失败轮次清理。
- 编译：pytest 77 passed；tsc 0 错误。

### ���� �� Ollama ����ʱһ��װ���ٷ�����������̬��
- ���򣺾�ѡģ�͡����ز����á����� Ollama ����ʱ������δװʱ��ťװ����0.1.6 hotfix �Ѹ�ָ�������������û��ֶ�ȥ����װ��
- ��񣺺�� +POST /api/config/ollama/install-runtime��NDJSON ������httpx.stream �� https://ollama.com/download/OllamaSetup.exe��������̬ httpx_proxy_for����.part ������Inno ��Ĭ /VERYSILENT �����Ա���ش���ollama_exe_path() ̽ PATH+LOCALAPPDATA\Programs\Ollama����װ����дע��� PATH ��ǰ���̲��ɼ�����status +has_binary��
- ǰ�ˣ�LocalModelSection ����״̬�У�δװʱ�ԡ�һ����װ���ٷ�������������primary ť+��������װ���Զ� serve()��
- ʵ�⣺system ��������ʽ�����¼�������0��7.8%�����ٷ�Դ�������ɴ
- ���룺tsc 0 ����pytest ȫ�̣���װ Z: ��֤ health 0.1.6��
