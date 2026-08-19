# 辩论引擎 UI 设计规范与参考模式

> 版本：v0.4（0.1.3 无外框 + v5 纸感审美）  
> 基于文件分类器（`2026-07-19/chat-1/file-classifier`）和 bili-comment-marker 两个软件的经验总结；
> v0.3 起以 §〇 双面布局总纲为当前规范，§一以下的三栏/设置布局在与 §〇 冲突时以 §〇 为准。

---

## 〇、双面布局总纲（0.1.2 当前版）

### 0.1 双支柱心智模型

软件只有两个"面"，全屏互斥显示，对应两大目的：

```
🗄 知识库面（数据支柱）                ⚔ 回应面（输出支柱）
┌────────────────────────────┐      ┌────────────────────────────┐
│ 🔍 全局检索框（常驻顶部）      │      │ 素材篮  │ 输入言论          │ 页 │
├─────┬───────────────┬──────┤      │ +历史   │ 意图：反驳|批判|评价 │ 边 │
│立场树│ 画布（四投影切换）│档案卡│      │ 收藏    │ |分析|综合报告     │ 注 │
│+筛选 │列表|图谱|逻辑链|脉络│      │      │        │ ──输出(72ch)──   │    │
└─────┴───────────────┴──────┘      └────────┴─────────────────┴────┘
        └────────── 素材篮 = 唯一跨面弹药通道（单向）──────────→
```

### 0.2 面切换四通道

| 通道 | 行为 | 动效 |
|---|---|---|
| 右上悬浮组主钮 | 点击切面；图标显示对面；素材篮角标 | 200ms 横向滑动 |
| 长按右键滑动 | ≥120px 生效；<10px 释放放行右键菜单；默认向左滑=去右面（可反转） | 跟手位移，松手补完/回弹 |
| Ctrl+Tab（可自定义） | 瞬切 | 零动画 |
| Ctrl+K 命令面板 | 带参切换（如"反驳这段话"） | 零动画 |

- 悬浮组=主钮（切面，静止 40% 透明度）+副钮（设置齿轮，小一号）；设置内可整组关闭，关闭时提示快捷键；
- 设置是**全屏覆盖浮层**（Ctrl+, / 齿轮，Esc 关闭），不是第三个面；
- 两面常驻不卸载，切换不丢工作状态；隐藏面暂停重渲染。

### 0.3 视觉语法（呼吸感六原则，token 化）

1. **间距成阶** 4/8/12/16/24/40：组内紧、组间松；
2. **减盒子**：层级靠背景明度差+发丝线（1px 低透明度），边框只留输入件；
3. **文字节奏**：字号阶 12/13/15/18/24，行高 1.6–1.7，长文 72ch 居中，标题上空 > 下空；
4. **收放对比**：大数字统计头+留白为"呼"，账本导轨逐条记录为"吸"；空状态必须设计（引导+示例动作）；
5. **色彩克制**：灰阶为底 + 唯一强调色落点 + 每立场低饱和主色；饱和色总面积越小越透气；
6. **动效轻呼吸**：过渡 150–250ms、列表 stagger 40ms、静止零动画、尊重 prefers-reduced-motion。

数据展示元素（源自 lieflat-charts 视觉语法）：StatHead 大数字统计头 / TickBar 可数刻度条（一格=一个真实单位）/ LedgerList 账本导轨列表 / 页边注（marginalia）右栏。

### 0.4 三态主题

深色 / 浅色（纸感）/ 跟随系统（默认）。**窗口标题栏必须随主题**：Tauri `Window.setTheme()`
+ conf 初始 theme 防首帧白闪；跟随系统监听 `onThemeChanged`。所有画布类组件（图谱/时间轴/逻辑链）
颜色一律取 token，禁止硬编码。报告导出 HTML 固定纸感浅色。

### 0.5 旧 tab → 双面映射

反驳→回应面(意图=反驳)；搜索→检索区段落视角；导入→馆藏拖放；对比→图景对比投影(库内)/回应面"分析"(粘贴)；图谱→图景；报告→回应面(意图=报告)；溯源→检索区论点+脉络视角；设置→覆盖浮层。

---

### 0.6 无外框窗口总纲（0.1.3 当前版）

- 系统外框关闭，顶部功能条=原外框位置：应用标 + 双面 tab + 全局检索 + 功能组（篮/切换/设置，同尺寸 32px）+ 自绘窗口控制钮
- 整条为拖动区（仅空白带，控件天然隔离）；双击=最大化/还原；关闭钮悬停=唯一红色落点
- 保留系统阴影；贴边分屏失效（接受）
- 设置=全屏覆盖浮层但不得遮 winctl（z-index 最高）

### 0.7 v5 纸感审美总纲与两层策略

- 框架层（顶栏/列/控件）：近乎隐形——无粗框、1px 发丝线、明度差最小、控件小而浅
- 展示层（图谱/逻辑链/时间轴/报告）：展品级，大留白、有序几何（等距刻度/径向环/竖格）、灰阶五档+半透明叠层
- 单色 + 唯一受控落点（accent 红）；立场族=单色多阶（实心/空心/点径），禁库默认蓝
- caps 小标签（9px mono、.18em 字距）作分节记号

### 0.8 交互词汇（呼吸感）

- 时长三档：160ms 悬停反馈 / 240ms 面板·弹层·切面按钮 / 400ms 图谱镜头；一律 ease-out 减速进场
- 静止零动画；唯一持续动效=加载呼吸点；reduced-motion 全归零
- 悬停只调墨色阶，不放大不位移；图谱悬停=邻域高亮其余淡出
- 列表 stagger 淡入+上浮 4px、间隔 40ms；弹层淡入+上浮 2px；出场只淡出
- 危险操作无动画直出确认条

### 0.9 图型规范（功能即形态）

- 逻辑链=流程图式：方框=论点（论点名+作者·年份）、箭头带文字标签=关系（演进/细化/支持/攻击）、自上而下=年代；读法零门槛
- 图谱=G6 力导换皮：邻域高亮、combo 折叠、镜头 400ms 滑近
- 时间轴=条码棒棒糖（高度=被引次数、唯一红点=焦点）+ 作者活跃期带
- 档案卡=三层堆栈；空态=单色线描插图

### 0.10 图标与字体规范

- 图标全自绘 1.4px 线型 SVG，禁 emoji 与现成库；桌面图标=侧视平叠四本书（页边/书脊交替、宽窄错落），纸白填充+墨线+红书签，固定色 .ico（16px 去书页线）
- 字体：思源黑体（界面/标题）+ 思源宋体（长文阅读）+ IBM Plex Mono（caps/大数字）；外挂安装目录 fonts\，不进安装包，未装静默回退

### 0.11 视觉四件（0.1.4 当前版）

- **主色系**：OKLCH 派生——用户选一主色（预设低饱和 swatch+色相滑杆），锁 C/L 阶只换 H；--accent 浅 L.45/深 L.65、--accent-dim 同 H 降 C alpha.12；WCAG 对比不足自动调 L；--err（关钮唯一红点）/stance-1..6/导出报告不跟主色（借 Radix/M3 单色生阶+深浅配对）
- **细线减法**：全页线 11→4——只留功能条下缘/工具区下缘一条/控件描边/纸叠层阴影；栏分隔改明度差（侧栏 bg-0、中栏 bg-1）；--hairline-strong 白名单=控件+功能条
- **高度阶梯**：40（功能条+三栏顶行同水平线）/32（一切交互控件，同行必同高，tab 选中=32 高 accent-dim 块零跳变）/24（chip 徽章）；字阶 fs-12 muted 标签·fs-13 值·caps 仅栏头；留白只准 sp-3/sp-4/sp-5
- **滚动条**：token 化（thin+scrollbar-color，::-webkit-scrollbar 族 thumb=--hairline-strong hover=--tx-3 track 透明 10px），深浅主题随动

### 0.12 设置长页与组件卡（0.1.4）

- 设置一滚到底：分区顺序铺开单滚动条；左导航变锚点目录+scrollspy 高亮；序按使用频率
- 退出钮=自绘线型「→」图标钮（title「关闭 (Esc)」）
- 组件中心卡片（借 ComfyUI-Manager/赛博史官模型管理）：名+「可选」标+一行说明+状态点；动作=自检/删除/下载·重下/禁用；四态=未装/下载中(进度条)/已装/禁用
- 数据目录块：路径只读+「迁移…」按钮；迁移带实时进度，旧目录保留并显示

### 0.13 回应面三轴合一（0.1.4）

- 意图并入风格单一轴：tab=回答/分析/综合报告；风格表 14 条（反驳/批判性分析/评价 吸收原三意图 prompt，其余笔法保留）
- 主行=风格/立场/格式/字数+生成回答；引用/检索/坐标中心/谬误检测进「高级」折叠
- 评价风格带 stance_free：选到时立场选择器隐藏（定义=多立场权衡不站队）；其产出归档进 archive/中立评价/
- 立场×笔法兼容：skill 文件 method_blacklist 行为事实源；不兼容笔法从待选**隐藏**，折叠可见灰显+原因；切立场时在选笔法被黑=自动回落默认+toast

### 0.14 素材组 UI（0.1.4）

- 左栏「素材组」：公共素材组永置顶（pinned 不可删改）+手动建组命名；组头计数；删组材料并公共组（无孤儿）
- 右键「加入素材组▸」子菜单（公共默认）；注入勾选跨组（公共在上）+整组注入快动作；计数 n/20（注入预算）

### 0.15 馆藏主从与可搜选择器（0.1.4）

- 知识库面去常驻左栏；馆藏 tab 主从：左=立场分组文档树（组头折叠/计数/全展全收/折叠态记忆/外部跳转自动展开），右=馆藏内容；统计三数变紧凑条进馆藏头部
- 文档/立场选择统一 combobox：输入即滤（标题/作者/拼音首字母）+命中字 accent 高亮（候选与检索结果同套 mark）+虚拟列表+↑↓/Enter/Esc；无匹配显「无匹配+已搜范围」；选中项旁「查看」小钮开右栏

### 0.16 统一阅读器外壳（0.1.4）

- 所有格式共用阅读器外壳：顶栏=文件名+格式徽章+conversion 标注+模式切换；纸感背景+--sans 排版
- pdf 原页模式内容保真优先（统一外壳不统一内容）；切「文本模式」回全统一块渲染
- xlsx 多 sheet 页签+自绘虚拟表格（不引 handsontable，许可坑）；docx 走 mammoth 块；md 走 marked（过 DOMPurify）

## 一、设置页面布局规范

### 1.1 标准左导航 + 右内容布局

该布局模式来自 `SettingsPage.tsx`（chat-1/bcm），已验证可用。

```tsx
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('model');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionsRefs = useRef<Record<string, HTMLElement | null>>({});
  
  const settingsSections = [
    { id: 'local_model', label: 'BGE-M3 本地模型', icon: Cpu },
    { id: 'api_provider', label: 'AI 服务商', icon: Cloud },
    { id: 'knowledge', label: '知识库管理', icon: Folder },
    { id: 'shortcuts', label: '快捷键', icon: Keyboard },
    { id: 'privacy', label: '隐私与安全', icon: Shield },
    { id: 'logs', label: '日志与诊断', icon: Activity },
    { id: 'about', label: '关于', icon: Info },
  ];

  // scroll-spy: 监听滚动，自动高亮当前可见的分区
  const handleScrollSpy = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    for (const [id, el] of Object.entries(sectionsRefs.current)) {
      if (el && el.offsetTop - scrollTop <= 100) {
        setActiveSection(id);
      }
    }
  }, []);
  
  return (
    <div className="flex min-h-[600px]">
      {/* 左侧固定导航 */}
      <nav className="w-52 border-r p-4 fixed left-0 top-0 bottom-0 overflow-y-auto">
        <input 
          placeholder="搜索设置..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="mb-4 w-full rounded border px-3 py-2 text-sm"
        />
        {settingsSections
          .filter(s => s.label.includes(searchQuery))
          .map(section => (
            <button key={section.id}
              onClick={() => {
                setActiveSection(section.id);
                sectionsRefs.current[section.id]?.scrollIntoView({ behavior: 'smooth' });
              }}
              className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left ${
                activeSection === section.id ? 'bg-blue-100 text-blue-700' : ''
              }`}
            >
              <section.icon size={18} />
              <span>{section.label}</span>
            </button>
          ))}
      </nav>
      
      {/* 右侧滚动内容区 */}
      <main className="ml-52 flex-1">
        <div ref={scrollRef} onScroll={handleScrollSpy} className="p-8 space-y-8">
          {settingsSections.map(section => (
            <section key={section.id} id={section.id}
              ref={el => { sectionsRefs.current[section.id] = el; }}
              className="scroll-mt-24"
            >
              {renderSectionContent(section.id)}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
```

**关键特性**:
- `scroll-spy`: 监听滚动事件，自动高亮当前可见的分区
- `smooth scrolling`: 点击导航时平滑跳转到对应区域
- `search filtering`: 实时过滤导航项（拼音匹配）
- `sticky header`: 分区标题吸顶效果

---

### 1.2 设置分区分类（两种本质不同的模块）

模型配置分为两个**性质完全不同**的分区，不能混涆：

| 分区 | 功能 | 参考来源 | 复用方式 |
|------|------|---------|--------|
| **BGE-M3 本地模型** | 模型文件下载、GPU加速、自检 | `file-classifier/ModelManager.tsx` | 直接复用核心逗辑 |
| **AI 服务商** | API Key、免费额度、降级链 | 新设计 | 参考 1.4 |
| **知识库存储** | 路径选择、迁移、云备份 | `StorageSection.tsx` | 直接复用 |
| **快捷键** | 键位映射表 | `ShortcutsSection.tsx` | 完全复用 |
| **日志与诊断** | 运行健康报告 | 新设计 | 参考 ARCH-debate-engine.md 第 23 章 |
| **关于** | 版本信息 | `AboutSection.tsx` | 直接复用 |

**不复用的分区**： AccountSection（纯本地，不需要登录）、FfmpegCard、VdlSection

---

### 1.3 BGE-M3 本地模型管理（直接复用 file-classifier 的 ModelManager）

> 来源：`2026-07-19/chat-1/file-classifier/src/components/ModelManager.tsx`，全文 512 行，已验证可用。

与 API 服务商配置不同，这部分管理的是本地模型文件，有以下特有阶段可直接复用：

**核心状态定义（L11-L57）**含有 `ModelStatus`、`DownloadProgress`、`NetworkStatus`、`GpuRuntimeStatus` 四个接口，直接迟载：

```tsx
interface ModelStatus {
  id: string;
  name_zh: string;       // 对应 BGE-M3
  installed: boolean;
  update_available: boolean;
  files: { dest: string; exists: boolean; size: number }[];
}
interface DownloadProgress {
  model_id: string;
  file_index: number;    // 当前第几个文件
  files_total: number;   // 总文件数
  downloaded: number;
  total: number;
  done: boolean;
  error: string | null;
}
```

**关键特性一：下载源选择 + 网络检测（L299-L358）**
中国用户遇到 HuggingFace 连接问题时必须能切换镜像源：

```tsx
{/* 下载源 */}
<div className="flex gap-1 rounded-lg p-1">
  {['auto', 'official', 'mirror'].map(s => (
    <button key={s} onClick={() => saveConfig({ source: s })}
      className={`btn ${cfg.source === s ? 'btn-primary' : 'btn-ghost'} text-xs`}>
      {s === 'auto' ? '自动' : s === 'official' ? '官方源' : '镜像源'}
    </button>
  ))}
</div>

{/* 网络检测： ping 两个源，比较延迟，自动推荐 */}
<button onClick={detectNetwork} disabled={detecting}>
  {detecting ? '检测中...' : '检测网络'}
</button>
{net && (
  <div className="text-xs">
    官方: {net.official_ms ?? '超时'} ms　镜像: {net.mirror_ms ?? '超时'} ms
    ▶ 推荐: {net.recommended}
  </div>
)}
```

**关键特性二：代理设置（L311-L329）——中国用户必须有此功能**

```tsx
{/* 三档代理 */}
{[['system','系统代理'], ['custom','自定义'], ['none','直连']].map(([k,label]) => (
  <button key={k} onClick={() => saveConfig({ proxy_mode: k })}
    className={cfg.proxy_mode === k ? 'btn-primary' : 'btn-ghost'}>
    {label}
  </button>
))}

{/* 自定义代理 URL + 连通测试 */}
{cfg.proxy_mode === 'custom' && (
  <div className="flex items-center gap-2">
    <input type="text" value={proxyUrlInput}
      onChange={e => setProxyUrlInput(e.target.value)}
      placeholder="http://127.0.0.1:7890" />
    <button onClick={saveProxyUrl}>保存</button>
    <button onClick={testProxy} disabled={proxyTesting}>
      {proxyTesting ? '测试中...' : '测试连通'}
    </button>
  </div>
)}
```

**关键特性三：GPU 安全模式横幅（L476-L480）——ONNX 崩溃自动回退**

```tsx
{gpu?.safe_mode && (
  <div className="flex items-center justify-between gap-3 text-xs px-3 py-2"
    style={{ border: '1px solid var(--warning)', color: 'var(--warning)' }}>
    <span>上次 GPU 加速导致崩溃，已自动切换 CPU 模式</span>
    <button onClick={handleReenableGpu}>重新启用 GPU</button>
  </div>
)}
```

**关键特性四：模型列表智能折叠默认（L271-L276）**

```tsx
// 展开条件：有未安装的必需模型或可更新项，或正在下载中
// 关闭条件：全部已安装且无更新 → 按用户上次操作记忆
const hasNeed = models.some(m => (!m.installed && !m.optional) || m.update_available);
const anyDownloading = models.some(m => downloading[m.id]);
const effectiveOpen = anyDownloading ? true : (modelsOpen ?? hasNeed);
```

**关键特性五：下载完成后自动自检（L98-L125）**

```tsx
// 下载前加入自劤列表
autoVerify.current.add(id);

// 下载完成事件里
if (p.done && !p.error && autoVerify.current.has(p.model_id)) {
  autoVerify.current.delete(p.model_id);
  runVerify(p.model_id);  // 自动走自检流程
}
```

**关键特性六：串行下载等待（L252-L265）——一键批量更新**

```tsx
// 用 Promise resolver 等待当前下载完成再开始下一个
const doneResolvers = useRef<Record<string, () => void>>({});

const downloadAndWait = (id: string) => new Promise<void>((resolve) => {
  doneResolvers.current[id] = resolve;  // 注册 resolver
  startDownload(id);
});

// 事件监听里触发
if (p.done) {
  const rz = doneResolvers.current[p.model_id];
  if (rz) { delete doneResolvers.current[p.model_id]; rz(); }
}

// 一键更新全部可更新模型（串行，不并行）
const updateAll = async () => {
  for (const m of models.filter(m => m.update_available)) {
    await downloadAndWait(m.id);  // 等前一个完成再开始
  }
};
```

---

### 1.4 AI 服务商配置（新设计，非复用）

> 注意：这个分区是第一个项目中没有的功能，是针对反驳引擎多 API 服务商的新设计。

```tsx
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface ProviderConfig {
  name: string;
  apiUrl: string;
  apiKey: string;
  models: string[];
  isOllama?: boolean;
}

export function ModelManager() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [currentProvider, setCurrentProvider] = useState<'groq' | 'gemini' | 'ollama'>('groq');
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  
  useEffect(() => {
    // 初始化时读取已配置的提供商
    loadProviders();
    
    // 监听模型列表更新事件
    listen('model_list_updated', () => updateModels());
  }, []);
  
  async function loadProviders() {
    const configs = await invoke<ProviderConfig[]>('get_model_providers');
    setProviders(configs);
  }
  
  async function addCustomProvider(name, url, key, modelList) {
    await invoke('add_provider', {name, url, key});
    await loadProviders();
  }
  
  async function testConnection(providerName) {
    setTesting(true);
    try {
      await invoke('test_connection', {provider: providerName});
      showToast({type: 'success', msg: '连接成功'});
    } catch(e) {
      showToast({type: 'error', msg: e.message});
    } finally {
      setTesting(false);
    }
  }
  
  function getFreeApiTier(providers) {
    return {
      groq: { limit: '14,400 次/天', cost: '永久免费' },
      gemini: { limit: '1,500 次/天', cost: '永久免费' },
      cerebras: { limit: '1M tokens/天', cost: '永久免费' },
      ollama: { limit: '本地速度', cost: '免费（硬件消耗）' },
    };
  }
  
  return (
    <div className="space-y-6">
      {/* 默认免费提供商选择 */}
      <Card title="默认模型服务提供商">
        <select 
          className="w-full rounded border px-3 py-2"
          value={defaultProvider}
          onChange={e => setDefaultProvider(e.target.value)}
        >
          {Object.entries(getFreeApiTier(providers)).map(([name, tier]) => (
            <option key={name} value={name}>
              {name.toUpperCase()} · {tier.cost} ({tier.limit})
            </option>
          ))}
        </select>
        
        <button onClick={() => saveDefaultProvider(defaultProvider)}>保存</button>
      </Card>
      
      {/* 自定义提供商配置 */}
      <Card title="自定义 API 配置">
        <div className="space-y-4">
          <input type="text" placeholder="服务商名称" className="w-full rounded border px-3 py-2" />
          <input type="url" placeholder="API 地址" className="w-full rounded border px-3 py-2" />
          <input type="password" placeholder="API Key" className="w-full rounded border px-3 py-2" />
          <textarea placeholder="模型列表（每行一个）" rows={5} className="w-full rounded border px-3 py-2" />
          
          <div className="flex gap-2">
            <button onClick={handleAddProvider} className="btn-primary">添加</button>
            <button onClick={testCurrent} disabled={testing}>测试连接</button>
          </div>
        </div>
      </Card>
      
      {/* Ollama 本地模型检测 */}
      <Card title="本地 Ollama 模型">
        <div className="flex items-center justify-between">
          <div>
            <strong>Ollama 服务状态:</strong>
            {isOllamaRunning ? '✓ 运行中' : '✗ 未运行'}
            
            {!isOllamaRunning && (
              <button onClick={() => openDownloadGuide()}>安装指南</button>
            )}
          </div>
          
          <div>
            <strong>可用模型:</strong>
            {localModels.map(model => (
              <div key={model.name}>
                {model.name} ({model.size}) - 
                <button onClick={() => useModel(model.name)}>使用此模型</button>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
```

---

### 1.4 StorageSection（知识库存储路径）可直接套用

**主要功能点**:

```tsx
// StorageSection.tsx 复用点
<Card title="知识库存储位置">
  {/* 当前路径显示 */}
  <div className="flex items-center gap-2">
    <FolderOpen size={18} />
    <span>{currentPath}</span>
    <Badge>{formatSize(totalSize)}</Badge>
  </div>
  
  {/* 修改按钮 */}
  <button onClick={selectNewPath}>修改路径</button>
  
  {/* 迁移进度条 */}
  <Progress 
    value={migrationProgress.percentage} 
    label={migrationProgress.status} 
  />
  
  {/* 磁盘空间预估 */}
  <InfoBanner>
    目标路径剩余空间: {freeSpace}
    {requiredSpace > freeSpace && (
      <Alert>空间不足，请至少预留 {requiredSpace - freeSpace}</Alert>
    )}
  </InfoBanner>
</Card>
```

**后端命令对接**:
```rust
#[tauri::command]
async fn select_storage_path(new_path: PathBuf) -> Result<()> {
    // 1. 检测新路径权限
    fs::create_dir_all(&new_path)?;
    
    // 2. 计算迁移所需时间
    let required_space = calculate_required_space().await?;
    let free_space = get_disk_free_space(&new_path)?;
    
    if required_space > free_space {
        return Err("Insufficient space".into());
    }
    
    // 3. 返回迁移确认对话框数据
    Ok(TransferConfirmData {
        source: current_path.clone(),
        destination: new_path.clone(),
        total_size: required_space,
        estimated_time: estimate_migration_time(required_space),
    })
}
```

---

### 1.5 ShortcutsSection（快捷键配置）完全复用

```tsx
// ShortcutsSection.tsx 核心逻辑
const SHORTCUT_DEFS = [
  { id: 'rebuttal_quick', label: '快速反驳生成', default: 'Ctrl+Enter' },
  { id: 'search_focus', label: '焦点到搜索框', default: 'Ctrl+F' },
  { id: 'toggle_sidebar', label: '切换侧边栏', default: 'Tab' },
];

useEffect(() => {
  listen<ShortcutEvent>('shortcut_triggered', async (event) => {
    switch (event.data.id) {
      case 'rebuttal_quick':
        handleQuickRebuttal();
        break;
      case 'search_focus':
        searchInput.focus();
        break;
    }
  });
}, []);

// 快捷键绑定 UI
{SHORTCUT_DEFS.map(def => (
  <div key={def.id} className="flex items-center justify-between p-3 border rounded">
    <span>{def.label}</span>
    <button onClick={() => editShortcut(def.id)}>
      {bindingMap[def.id]} → 修改
    </button>
  </div>
))}
```

---

## 二、通用 UI 组件模板

### 2.1 Toast 通知系统（完全照搬）

```tsx
// App.tsx L7076-7095
interface ToastEntry {
  id: number;
  msg: string;
  type: 'success' | 'error' | 'warning';
  action?: { label: string; onClick: () => void };
  leaving?: boolean;
}

function App() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastSeq = useRef(0);
  
  function showToast({type, msg, action}) {
    const id = ++toastSeq.current;
    setToasts(t => [...t, {id, msg, type, action}]);
    
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, 3000);  // 3 秒后自动消失
  }
  
  return (
    <div className="fixed right-4 bottom-4 z-[200] space-y-2">
      {toasts.map(toast => (
        <div 
          key={toast.id}
          className={`rounded-lg p-4 shadow-lg max-w-md animate-slide-up ${
            toast.type === 'success' ? 'bg-green-500 text-white' :
            toast.type === 'error' ? 'bg-red-500 text-white' :
            'bg-yellow-500 text-white'
          }`}
        >
          <div className="flex items-start gap-2">
            {toast.type === 'success' && <CheckCircle2 />}
            {toast.type === 'error' && <AlertCircle />}
            {toast.type === 'warning' && <AlertTriangle />}
            <span className="flex-1">{toast.msg}</span>
            
            {toast.action && (
              <button 
                onClick={() => {
                  toast.action.onClick();
                  setToasts(t => t.filter(x => x.id !== toast.id));
                }}
                className="underline hover:no-underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**使用示例**:
```tsx
// 入库失败
showToast({
  type: 'error',
  msg: '第 12 章分析失败（API 超时），已切换到本地模型重试',
  action: {
    label: '撤销',
    onClick: () => revertLastIngestion()
  }
});

// 批量删除成功
showToast({
  type: 'success',
  msg: '已成功删除 5 篇文档及其所有引用'
});

// 警告提示
showToast({
  type: 'warning',
  msg: 'Gemini API 配额只剩 15%，建议使用 Groq',
  action: { label: '切换', onClick: switchToGroq }
});
```

---

### 2.2 模态框统一结构（注意：必须是组件，不能是函数）

> 错误示警：在普通函数里调用 `useState` 会报 "Invalid hook call"。必须用组件形式。

```tsx
// ✅ 正确：模态框是一个 React 组件
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  dangerMode?: boolean;
  checkboxLabel?: string;
  onConfirm: (checked?: boolean) => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title, message,
  confirmText = '确定', cancelText = '取消',
  dangerMode = false, checkboxLabel,
  onConfirm, onClose,
}: ConfirmDialogProps) {
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  
  return (
    <div className="fixed inset-0 bg-black/60 z-[100]"
      onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[120]
        w-[500px] max-h-[80vh] overflow-y-auto bg-white rounded-lg shadow-xl">
        
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-500">×</button>
        </div>
        
        <div className="p-4 text-gray-600 leading-relaxed">
          {message}
          {dangerMode && checkboxLabel && (
            <div className="mt-4 pt-4 border-t">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={checkboxChecked}
                  onChange={e => setCheckboxChecked(e.target.checked)}
                  className="w-4 h-4" />
                <span className="text-sm">{checkboxLabel}</span>
              </label>
            </div>
          )}
        </div>
        
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">
            {cancelText}
          </button>
          <button
            onClick={() => { onClose(); onConfirm(checkboxChecked); }}
            disabled={dangerMode && !checkboxChecked}
            className={`px-4 py-2 rounded ${
              dangerMode && !checkboxChecked
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// 调用方式：通过 state 控制显示
hide
function App() {
  const [confirmOpts, setConfirmOpts] = useState<ConfirmDialogProps | null>(null);

  function showConfirm(opts: Omit<ConfirmDialogProps, 'onClose'>) {
    setConfirmOpts({ ...opts, onClose: () => setConfirmOpts(null) });
  }

  // 危险操作（必须 checkbox）
  const handleClearKnowledgeBase = () => showConfirm({
    title: '清空知识库',
    message: '这将删除所有文档、向量和索引，不可撤销',
    dangerMode: true,
    checkboxLabel: '我已理解此操作的严重性',
    onConfirm: () => clearAllKnowledgeBase(),
  });

  return (
    <>
      {confirmOpts && <ConfirmDialog {...confirmOpts} />}
    </>
  );
}

---

### 2.3 底部进度条（长任务必备）

```tsx
// App.tsx L7055-7064
interface ProgressState {
  isShowing: boolean;
  done: number;
  total: number;
  status: string;  // "正在处理第 X 章...""
  percent: number;  // 进度百分比
}

function App() {
  const [progress, setProgress] = useState<ProgressState>({
    isShowing: false,
    done: 0,
    total: 0,
    status: '',
    percent: 0,
  });
  
  useEffect(() => {
    listen('ingestion_progress', async (event) => {
      const data = event.payload;
      
      if(data.event === 'start') {
        setProgress({
          isShowing: true,
          done: 0,
          total: data.total_chapters,
          status: '开始处理...',
          percent: 0,
        });
      } else if(data.event === 'progress') {
        setProgress(prev => ({
          ...prev,
          done: data.processed,
          total: data.total,
          status: `正在处理第${data.chapter_num}章...`,
          percent: Math.round(data.processed / data.total * 100),  // number类型
        }));
      } else if(data.event === 'end') {
        setProgress(prev => ({...prev, isShowing: false}));
        showToast({type:'success', msg:`入库完成，共${data.total}章`});
      }
    });
  }, []);
  
  return (
    <>
      {progress.isShowing && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 z-[150]">
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-between mb-1 text-sm text-gray-600">
              <span>{progress.status || `已处理 ${progress.done}/${progress.total}`}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{width: `${progress.percent}%`}}
              />
            </div>
            
            <div className="flex gap-2 mt-2">
              <button onClick={pauseIngestion}>暂停</button>
              <button onClick={resumeIngestion}>继续</button>
              <button onClick={cancelIngestion}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

---

## 三、坑经验总结（架构层面）

### 3.1 TDZ（Temporal Dead Zone）规避

**问题**: `useCallback`依赖中的函数在定义前被引用

**错误示例**:
```tsx
function App() {
  // ❌ 错误：changeZoomMode先被引用了
  const handleSomeEvent = useCallback(() => {
    changeZoomMode('fit-to-width');  // ReferenceError!
  }, []);
  
  function changeZoomMode(mode) {...}
}
```

**正确做法**:
```tsx
function App() {
  // ✅ 先定义基础函数
  function changeZoomMode(mode) {...}
  
  // ✅ 再写回调，依赖可以引用它
  const handleSomeEvent = useCallback(() => {
    changeZoomMode('fit-to-width');
  }, []);
}
```

---

### 3.2 Race Condition 预防（cancelReconcile）

**问题**: 多次触发导致旧状态覆盖新状态

**错误示例**:
```tsx
useEffect(() => {
  fetchDocuments().then(result => setState(result));
}, [query]);  // query 变化快于 fetch 完成

// 可能结果：A query 先完成，然后 B query 也完成但覆盖了 A 的结果
```

**正确做法**:
```tsx
useEffect(() => {
  let cancelled = false;
  
  async function fetchData() {
    const result = await fetchDocuments(query);
    if(!cancelled) setState(result);
  }
  
  fetchData();
  
  return () => {cancelled=true;};  // cleanup
}, [query]);
```

---

### 3.3 Optimistic Update（乐观更新）

**问题**: 等待后端 API 响应期间界面无反馈

**错误示例**:
```tsx
async function likeFile(id) {
  // ❌ 等 API 完成才更新
  await invoke('like_file', {id});
  setState(t => t.map(f => f.id === id ? {...f, liked:true} : f));
}
```

**正确做法**:
```tsx
async function likeFile(id) {
  // ✅ 先本地标记
  setState(t => t.map(f => f.id === id ? {...f, liked:true} : f));
  
  try {
    await invoke('like_file', {id});
  } catch(e) {
    // 失败时回滚
    rollbackLikeState(id);
    showToast({type:'error', msg:e.message});
  }
}
```

---

## 四、可直接复制的 Code Snippets

### 4.1 列表分组展示

```tsx
// facetGroups.tsx
function FacetGroups({items, groupBy}) {
  const groups = useMemo(() => {
    return items.reduce((acc, item) => {
      const key = groupBy(item);
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items, groupBy]);
  
  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([key, groupItems]) => (
        <CollapsibleGroup key={key} header={`${key} (${groupItems.length})`}>
          {groupItems.map(item => <ListItem key={item.id} {...item} />)}
        </CollapsibleGroup>
      ))}
    </div>
  );
}
```

---

### 4.2 虚拟滚动网格

```tsx
const CELL_HEIGHT = 120;  // 每个卡片高度 px

export function VirtualGrid<T extends { id: number | string }>(
  { items, renderItem }: { items: T[]; renderItem: (item: T) => React.ReactNode }
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;  // ✅ 空指针保护
    const handleScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);  // ✅ 卸载时 el 仍然有效
  }, []);
  
  const VISIBLE_COUNT = Math.ceil((containerRef.current?.clientHeight ?? 600) / CELL_HEIGHT) + 2;
  const visibleStart = Math.floor(scrollTop / CELL_HEIGHT);
  const visibleEnd = Math.min(visibleStart + VISIBLE_COUNT, items.length);
  
  return (
    <div ref={containerRef} className="overflow-y-auto" style={{ height: '100%' }}>
      <div style={{ height: `${items.length * CELL_HEIGHT}px`, position: 'relative' }}>
        {items.slice(visibleStart, visibleEnd).map((item, idx) => (
          <div key={item.id}
            style={{ position: 'absolute', top: `${(visibleStart + idx) * CELL_HEIGHT}px`,
                     width: '100%', height: `${CELL_HEIGHT}px` }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### 4.3 空状态提示

```tsx
// EmptyState.tsx
export function EmptyState({icon, title, description, action}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-gray-400 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-700 mb-2">{title}</h3>
      <p className="text-gray-500 max-w-md mb-4">{description}</p>
      
      {action && (
        <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          {action.label}
        </button>
      )}
    </div>
  );
}

// 使用示例
if(items.length === 0) {
  return <EmptyState 
    icon={<Search size={48} />}
    title="暂无搜索结果"
    description="尝试调整筛选条件或扩大搜索范围"
    action={{label: '重新导入文献'}}
  />;
}
```

---

*本文档持续更新，新增 UI 模式时会补充此处。*

---

### 4.4 Context Menu 边界检测（单击不溢出屏幕）

```tsx
interface ContextMenuState {
  x: number; y: number;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    
    let left = menu.x;
    let top = menu.y;
    const { offsetWidth: w, offsetHeight: h } = el;
    
    // 如果右侧溢出，向左弹出
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    // 如果下方溢出，向上弹出
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    
    setPos({ left, top });
  }, [menu.x, menu.y]);
  
  // 点击任意地方关闭
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);
  
  return (
    <div ref={menuRef}
      className="fixed z-[300] min-w-[160px] rounded-lg shadow-xl border bg-white py-1"
      style={{ left: pos.left, top: pos.top }}
      onClick={e => e.stopPropagation()}>
      {menu.items.map((item, idx) => (
        <button key={idx}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
            item.danger ? 'text-red-600' : 'text-gray-700'
          }`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

---

### 4.5 流式输出组件（反驳生成必备）

反驳生成是长时间操作，必须边生成边显示，不能等全部完成再显示。

```tsx
export function StreamingText({ streamKey }: { streamKey: string }) {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  
  useEffect(() => {
    let cancelled = false;
    
    const unlistenPromise = listen<{ key: string; chunk: string; done: boolean }>(
      'rebuttal_stream',
      (event) => {
        if (cancelled || event.payload.key !== streamKey) return;
        
        if (event.payload.done) {
          setIsStreaming(false);
        } else {
          setText(prev => prev + event.payload.chunk);
          setIsStreaming(true);
        }
      }
    );
    
    return () => {
      cancelled = true;
      unlistenPromise.then(f => f());
    };
  }, [streamKey]);
  
  return (
    <div className="relative">
      <div className="prose max-w-none">{text}</div>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5" />
      )}
    </div>
  );
}
```

---

### 4.6 防抖 Hook

搜索框、设置滑块等高频输入场景必备：

```tsx
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return debouncedValue;
}

// 使用示例
// 搜索框：用户停止输入 300ms 后再调用搜索 API
function SearchBox() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  
  useEffect(() => {
    if (debouncedQuery) fetchSearchResults(debouncedQuery);
  }, [debouncedQuery]);
  
  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}

// 设置滑块：用户滑动停止 500ms 后再存入配置
function ThresholdSlider() {
  const [value, setValue] = useState(0.85);
  const debouncedValue = useDebounce(value, 500);
  
  useEffect(() => {
    invoke('set_tag_floor_threshold', { threshold: debouncedValue });
  }, [debouncedValue]);
  
  return <input type="range" min={0.2} max={0.85} step={0.05}
    value={value} onChange={e => setValue(parseFloat(e.target.value))} />;
}
```
