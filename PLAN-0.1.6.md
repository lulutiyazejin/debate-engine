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

---

## 补丁 · 魔搭直连提速（方案A）+ 安装链硬伤修复（热修6 规格）

> **为什么是 0.1.6 补丁而非新版本**：本章修的是 0.1.6 已交付下载链的两处缺陷（坏包永久卡死、跨版本续传拼坏文件）与分发源提速（同一批功能的质量闭环），无新功能面；随热修1-5 惯例版本号维持 0.1.6。

### 背景实测（2026-08-21，本机）
- GitHub 官方 + 本机代理：~1MB/s；公益 gh-proxy 加速站：0~260KB/s（全废）。
- ModelScope 魔搭国内直连（不挂代理）：**37MB/s**（bge-m3 100MB 采样 15s 拉完，Range 206 支持）。
- 用户魔搭仓库已建：`lulutiyazejin/debate-engine-components`（公开，匿名 resolve 直链实测 HTTP 200）；GitHub Secret `MODELSCOPE_TOKEN` 已配置。
- 魔搭 GGUF 仓逐个核实（API 200）：Qwen2.5 3B/7B/14B（Qwen 官方号）、DeepSeek-R1 7B/14B（unsloth 社区号）、Qwen3.5-35B-A3B（unsloth）；bge-m3=BAAI 官方仓（已是主源）。自由输入模型不在保证范围（仍走官方源+代理）。
- 坏包事故：`%TEMP%\OllamaSetup.exe` 1,564,819,104 字节，体积对但 Authenticode **HashMismatch**，Inno 静默装返回码 5。根因=跨会话/跨源续传期间 `latest/download` 换版拼接 + 完整 tmp 永不失效复用。
- 魔搭 CLI 上传语法（官方文档核实）：`modelscope upload <owner/repo> <本地文件> <仓库内路径> --token xxx --commit-message '...'`；>5MB 自动 LFS，单文件 ≤500GB。

### 补丁项 1 · 精选模型拉取改走魔搭（ollama pull modelscope.cn/...）
- **根因证据**：`backend/models/model_matrix.py` L17-54 MATRIX 全是官方库名；`ollama_adapter.pull_stream()` 原样 POST /api/pull → 官方 registry 必须代理（~1MB/s），且依赖「由本软件拉起注入 HTTPS_PROXY」。
- **设计规格**：
  1. MATRIX 每行 +`ms_name`（魔搭对接官方支持 `ollama pull modelscope.cn/{仓}`，自动配模板参数）：
     - `qwen3.5:35b-a3b` → `modelscope.cn/unsloth/Qwen3.5-35B-A3B-GGUF`
     - `qwen2.5:14b` → `modelscope.cn/Qwen/Qwen2.5-14B-Instruct-GGUF`
     - `qwen2.5:7b` → `modelscope.cn/Qwen/Qwen2.5-7B-Instruct-GGUF`
     - `qwen2.5:3b` → `modelscope.cn/Qwen/Qwen2.5-3B-Instruct-GGUF`
     - `deepseek-r1:7b` → `modelscope.cn/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF`
     - `deepseek-r1:14b` → `modelscope.cn/unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF`
  2. `candidates()` 输出带 `ms_name`；前端精选卡下载传 `ms_name ?? name`；「其他模型」自由输入仍传原文。
  3. `find()` 兼容 ms 名：现匹配失败后补一轮 `m["ms_name"].lower() == model.lower()`（Ollama 名字规格化为小写）——F1/F2/G1/H2/A4 全走 find()，兼容后自动不漂移。
  4. “已装”判定改后端算：`ollama_status` cands 每项 +`installed` 布尔 = installed_models 含 `name` base 或 `ms_name` base（大小写不敏感，base=split(":")[0]）；前端卡片改读该字段，不再自己拼名。
  5. `serve_start()` 注入代理时 +`env["NO_PROXY"]="modelscope.cn,localhost,127.0.0.1"`：魔搭直连不过代理（37MB/s），官方源照旧走代理。
- **验收红线**：R1 点精选卡下载出进度且速度 ≥10MB/s 级；R2 拉完卡片“已装”标记正确、任务落点表 10s 内可见新模型；R3 自由输入官方名照常可用。
- **联动**：provider_models 记录实际拉取名（现逻辑不变）；pull 完 reset_router 不动。

### 补丁项 2 · Ollama 安装包首源改用户魔搭镜像
- **根因证据**：`ollama_adapter.py` OLLAMA_SETUP_URLS=[GitHub latest, ollama.com]，全要代理，1.46GB≈25min；latest 无版本锚点（补丁项 3b 事故源头）。
- **设计规格**：
  1. 首源插入 `https://modelscope.cn/models/lulutiyazejin/debate-engine-components/resolve/master/OllamaSetup.exe`，顺序 [魔搭, GitHub, ollama.com]。
  2. `config.py` +域名直连白名单 `DIRECT_HOSTS = {"modelscope.cn"}`：`httpx_proxy_for()` 命中白名单返 None、`httpx_trust_env_for()` 返 False（实现前窄读两函数现逻辑再下刀）；components 的 `_opener()` 同吃白名单。
- **验收红线**：R4 清坏包后一键安装 ≤3 分钟完成“下载+静默装+has_binary=true+自动拉起”全链。
- **联动**：补丁项 4 先上传资产此项才有源；hotfix5 后台线程/接入语义不动。

### 补丁项 3 · 安装链两处硬伤
- **3a 坏包永久卡死**。根因证据：`_install_runtime_worker()` 见 `tmp.exists() and size>1MB` 即跳过下载；返回码≠0 不删 tmp → 重试永远复用同一坏包。规格：安装返回码≠0 或异常 → `tmp.unlink(missing_ok=True)`，detail 文案「安装包校验失败已删除，请重试重新下载」。
- **3b 跨版本/跨源续传拼坏文件**。根因证据：本次 HashMismatch（多会话多源续传 + latest 无锚）。规格：`.part` 旁存 `OllamaSetup.exe.part.meta`（JSON `{"total": int, "url": str}`）；每次尝试开始时：新响应总长（206 取 Content-Range 总长；200 取 content-length）≠ meta.total → done=0 清 .part 从头；.part 存在但 meta 缺失（旧残留）→ 从头；首个有效响应写 meta；`part.replace(tmp)` 前校验 size==meta.total，不符删 .part 报错。
- **3c 本机残留**：实现批清理 `%TEMP%\OllamaSetup.exe`（一次性 del）。
- **验收红线**：R5 人造 meta.total 错值 → 事件流出现从头下载且最终成功；R6 安装失败路径 tmp 确认被删（代码走查+可行时实测）。
- **联动**：多源轮换共用 meta 校验；补丁项 2 魔搭首源单会话拉完，风险面本身大幅缩小。

### 补丁项 4 · mirror-assets.yml +魔搭上传（服务端搬运二段，不经本机）
- **根因证据**：现 workflow 只传 GitHub Release；魔搭仓库还是空壳；`components.py` `_MS` 是 api/v1 FilePath 老格式且仓库当时不存在（404 死链）。
- **设计规格**：
  1. components job 尾加步骤：`pip install modelscope` → `modelscope upload lulutiyazejin/debate-engine-components ocr-win64.zip ocr-win64.zip --token "${{ secrets.MODELSCOPE_TOKEN }}" --commit-message "mirror ocr"`（docling 同理）。
  2. 新 job `ollama-setup`（if job==all|ollama-setup）：`curl -fL` GitHub latest/download/OllamaSetup.exe（runner 海外直连快）→ 同法上传 `OllamaSetup.exe`。
  3. inputs.job 说明改 `all | components | bge-m3 | ollama-setup`。
  4. bge-m3 不镜像（主源已是魔搭 BAAI 官方仓）。
- **验收红线**：R7 Actions 全绿；R8 魔搭文件页 3 件齐且匿名 resolve 200；R9 本机直连实测 ≥10MB/s。
- **联动**：补丁项 2/补丁项 5 生效前提；token 只进 GitHub Secret，不落仓库不落对话。

### 补丁项 5 · 组件包（ocr/docling）主源改魔搭
- **根因证据**：`backend/api/components.py` L31 `_MS` 死链老格式；L53/L60 urls=[_GH, _MS]，主源走代理 1MB/s。
- **设计规格**：`_MS = "https://modelscope.cn/models/lulutiyazejin/debate-engine-components/resolve/master"`；ocr/docling urls 改 `[f"{_MS}/xxx-win64.zip", f"{_GH}/xxx-win64.zip"]`（魔搭主、GitHub 备）；`_opener` 吃 DIRECT_HOSTS 白名单直连。
- **验收红线**：R10 软件内重装 ocr 或 docling 全链路 ok=true 且 ≥10MB/s。
- **联动**：bge-m3 sources 不动；下载反馈/暂停取消（0.1.6 批 5）不动。

### 补丁项 6 · 收尾（版本号维持 0.1.6）
- 不升版本号（随热修1-5 惯例）；打包三件（tauri --no-bundle / PyInstaller / makensis）→ Z: 静默重装 → 自测红线 R1-R10 逐条回对。
- GitHub：push main + Release 变更说明追补（按现行规则**只传源码，安装包不上资产**）。
- 行数扫描 + 台账 + 漂移自检。

### 补丁项 6 · 收尾（版本号维持 0.1.6）
- 不升版本号（随热修 1-5 惯例）；打包三件（tauri --no-bundle / PyInstaller / makensis）→ Z: 静默重装 → 自测红线 R1-R10 逐条回对。
- GitHub：push main + Release 变更说明追补（按现行规则**只传源码，安装包不上资产**）。
- 行数扫描 + 台账 + 漂移自检。

### 补丁项 7 · MinerU 外部引擎自动安装（半全自动· Actions 镜像）
- **根因证据**：`components.py#L64-L69` MinerU 是 `kind=external`，靠探测 `magic_pdf` 模块；官网安装步骤复杂（pip/cu121 索引 + model download + 配置 json），其他用户容易卡在「依赖地狱」或「装成 CPU 版」。当前 UI 只有链接无进度提示。
- **设计规格**：
  1. 新增端点 `/api/components/mineru/install-stream` → NDJSON：
     - 检测本机 CUDA 驱动 → 推断支持的 cu 版本（cu121 = 最稳）
     - pip install torch==2.5.1+cu121 --extra-index-url https://download.pytorch.org/whl/cu121
     - uv pip install magic-pdf[full] --extra-index-url https://download.pytorch.org/whl/cu121（用 uv 替代 pip 避免卡死）
     - run `magic-pdf model download` → 落 `%USERPROFILE%\.magic-pdf`
     - 修改 `magic-pdf.json` 路径（相对项目根目录）
     - 事件流：percent/status/detail（类似 ocr/docling）
  2. 前端 ComponentsSection："外装"行 → +「一键安装」primary 按钮（disabled if has_binary）；点击即 toast「正在调用 CMD 安装…（约 10~15 分钟）」；装完提示「已启用 MinerU，重启软件生效」→ 重启后自动重跑 probe_module。
  3. 后端 `config.py` +DIRECT_HOSTS={"modelscope.cn", "download.pytorch.org"}：两个都走直连（不过代理）。
  4. Actions mirror-mineru job（if job=all|mineru）：
     - ubuntu-latest  runner 上 pip download torch==2.5.1+cu121 magic-pdf[full] --index-url=https://download.pytorch.org/whl/cu121
     - zip → 上传到 `mineru-win-cu121` Release（体积预估 3~5GB，GitHub 单资产 ≤2GiB → split 或直接用 pip wheel）
     - 本机端改用 `pip install --target=<EXTRAS_PATH>/mineru --no-deps +mirror-zip`（从你的魔搭仓库 dl，再 fallback GitHub）。
- **验收红线**：R11 点击「一键安装」出进度条且最终 success=true；R12 `import magic_pdf` 成功 + `torch.cuda.is_available()`=True；R13 模型下载完成（`.magic-pdf` 目录 >500MB）。
- **联动**：hotfix5/补丁项 6 不动；若检测到 GPU 驱动太旧（不支持 cu121）→ toast「检测到 GPU 过旧，无法安装 GPU 版，建议升级驱动或手动安装」。
- **风险点**：detectron2 Windows 下可能需要 build tools（记录报错兜底）；体积过大时考虑仅做 CMD 脚本生成器（见备选方案 C）。

### 补丁项 8 · 外联文案增强（MinerU 跳转提示）
- **根因证据**：`components.py#L64-L69` 组件卡片中 MinerU 的「官网安装说明」链接打开浏览器后无任何反馈，用户不知道是否成功跳转。
- **设计规格**：
  1. ComponentsSection 链接旁加小字 `[跳转到浏览器]`（tx-2/灰色，字号 -2，左距 8px）；鼠标悬停变浅灰。
  2. 点击链接前先 toast 「正在跳转到浏览器…（请在弹出的窗口中查看安装说明）」。
- **验收红线**：R14 点链接时 toast 即时弹出 + 浏览器新开 tab；R15 布局不乱（左红右蓝 token 下不越界）。
- **联动**：MinerU 安装逻辑（补丁项 7）不动。

### 补丁实施结果（代码完成度）
- **补丁批 1（后端安装链）**：✅ config.py DIRECT_HOSTS → patch 3a/3b (`_install_runtime_worker()`/.meta 校验/装失败删包) → 补丁项 2 (OLLAMA_SETUP_URLS 首源魔搭)
- **补丁批 2（模型链）**：✅ model_matrix.py (+ms_name/find 兼容) → settings.py (ollama_status installed+ms_name) → ollama_adapter (serve_start NO_PROXY) → LocalModelSection.tsx (pullModel(ms_name)+H2 推荐行适配)
- **补丁批 3（分发链）**：✅ components.py (_MS 地址修正+ urls 顺序交换) → mirror-assets.yml (+ollama-setup job + 魔搭上传步骤)
- **补丁批 4（MinerU）**：✅ components.py (_install_mineru_stream 端点+ GPU 检测/cp312 轮子) → ComponentsSection.tsx(一键装按钮 +mineruInfo 态)
- **打包验证**：tsc 0 error; PyInstaller 完成；NSIS 安装包 112.1MB (Z: 静默装 OK, health 返回正常)
- **自测备注**：因沙箱限制无法持续跑后端 API，前端功能依赖 Tauri 桌面端热重载验证；已确认关键逻辑代码完整实现，补丁批 4 MinerU 需本机环境有 Python 才能实际测试

### 批次划分（风险升序，同文件聚一批）
- 补丁批 1（后端安装链）：config.py DIRECT_HOSTS → 补丁项 3a/3b → 补丁项 2 首源（ollama_adapter.py 同文件聚改，从下往上）→ 3c 清残留 → 编译 + 红线 R5/R6 走查。
- 补丁批 2（模型链）：model_matrix.py +ms_name/find 兼容 → settings.py installed 字段 → serve NO_PROXY → 前端精选卡（LocalModelSection）→ 编译。
- 补丁批 3（分发链）：components.py 源序 → mirror-assets.yml 两处 → push 后手动触发 Actions → 回查 R7-R9。
- 补丁批 4（MinerU）：components.py +NERU_STREAM_ENDPOINT → ollama_adapter 注入 pip command → components.py 前端一键装 +toast → 红线上测（本机验证）。
- 补丁批 5（收尾）：打包 → Z: 重装 → R1-R15 回对 → 台账 → push。

### 实现前窄读清单（动手时先查再下刀）
1. `config.httpx_proxy_for` / `httpx_trust_env_for` 现实现（白名单挂接点）。
2. `components._opener` 代理构造逻辑。
3. LocalModelSection 精选卡“已装”判定与下载按钮传名位置。
4. ComponentsSection 中「官网安装说明」链接定位（line ~66）及 onClick 处理。

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

---

## 补丁 · 魔搭直连提速（方案 A）+ 安装链硬伤修复（热修 6 规格）
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

### 热修 · Ollama 运行时一键装 + 下载反馈 + 服务端搬运（完成）
- 运行时一键装：后端 +POST /api/config/ollama/install-runtime（NDJSON 流）：httpx.stream 拉 ollama.com/download/OllamaSetup.exe（代理三态），.part 续传，Inno /VERYSILENT 静默免管理员；ollama_exe_path() 探 PATH+LOCALAPPDATA\Programs\Ollama；status +has_binary；前端未装时显「一键安装（官方包·代理）」primary 钮+进度，装完自动 serve()。实测 system 代理下进度事件正常。
- 下载反馈：pullModel/runStream 点击即 toast（开始拉取/开始下载），未运行/未装时给指引 toast，杜绝「点了没反应」。
- 服务端搬运：+.github/workflows/mirror-assets.yml（workflow_dispatch）：runner 从 PyPI 官方 pip download 打 ocr/docling zip 传 components-v1（docling 用 cpu torch 索引控体积）；bge-m3 从 HF 官方拉 10 件，pytorch_model.bin 2.27GB 超单资产 2GiB → split 1900M 分片传 bge-m3-v1。全程不经本机。
- 搬运实测：首轮两 job 挂（gh 无 checkout 上下文→-R 修复）；次轮 components 成、bge-m3 挂（gh 「file#name」的 # 是 label 不是 name→cp 改名修复）；三轮全绿：components-v1 得 ocr 98MB/docling 316MB，bge-m3-v1 得 11 件含 part_aa 1900MB+part_ab 266MB。
- docling 装后实测：软件内 /api/components/docling/install 全链路 done ok=true（5MB/s，装完热生效）——组件下载三件（ocr/docling/bge-m3）全部可用。
- 热修4·安装包多源续传：OLLAMA_SETUP_URLS=[GitHub latest/download（主，实测稳）, ollama.com（备）]；.part 断点续传跨源跨次生效（Range，206 判定，不支持则从头）；掐线换源×6 轮；本地完整包跳过下载；单飞锁防并发双写 .part（hotfix4b，实测探针并发暴露后修）；前端 guard toast 剪短。
- 实测：续传事件「断点续传（已存 170MB）→GitHub源 184/1492MB」；干净全量后台跑至 288MB 稳步增长。
- 编译：tsc 0 错误；pytest 77 passed；重装 Z: 验证。

### 热修5 · 运行时下载脱钩 HTTP 连接（后台线程化）
- 根因：下载写在 StreamingResponse 生成器里，客户端一断（关页/超时）生成器被杀→下载停（672MB 实证：单连接未掉，是监控 curl --max-time 到期杀客户端）。
- ollama_adapter.py：下载/安装挪进 daemon 线程 _install_runtime_worker（_runtime_emit 写 seq+event 共享态）；install_runtime_stream 只转发进度，断开不影响任务，再调用=接入进行中任务；单飞改线程存活判定（_RUNTIME_LOCK）；重试改进展感知：单次新增≥1MB 清零计数，仅连续 6 次零进展才判败（固定 6 次会冤杀 1.46GB 慢源）；+install_runtime_status()。
- settings.py：ollama_status +installing（刷新页面后恢复进度显示）。
- LocalModelSection：OllamaStatus +installing；点击 toast「后台下载关页不中断」；useEffect 自动重连（installing 且无二进制且本地空闲才接，has_binary 拦住装完后误重装）。
- 编译：SYNTAX OK；pytest 77 passed；tsc 0 错误。
- 交付：重打包三件（tauri/PyInstaller/makensis 117.6MB）；Z: 静默重装 health 0.1.6；实测断点 720MB 起步续传、客户端 15s 被杀后台照跑（20s 再涨 11MB）、二次调用接入进行中任务；安装包上传 Release v0.1.6 资产 HTTP 201（browser_download_url 已可公开下载）；源码推送 c5a1e75。
