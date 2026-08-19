// 双面骨架（PLAN-0.1.2 项目7/8/9/24 + PLAN-0.1.3 C1/C2/C6）：
// 无外框窗口：顶部功能条=拖动区（应用标+双面tab+篮角标+设置+自绘窗口控制钮）。
// 切换通道：功能条 tab / 长按右键滑动(≥120px) / Ctrl+Tab(瞬切) / Ctrl+K 命令面板。
// 设置 = 全屏覆盖浮层（不遮 winctl）；两面常驻挂载不卸载。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { api, engineBase, waitEngine } from "./api";
import LibraryFace from "./faces/LibraryFace";
import RespondFace from "./faces/RespondFace";
import SettingsPanel from "./panels/SettingsPanel";
import { initTheme, initExternalFonts } from "./theme";
import "./tokens.css";
import "./styles.css";

export interface DocRow {
  doc_id: string;
  title?: string;
  author?: string;
  stance?: string;
  doc_type?: string;
  summary?: string;
  coordinates?: string;
  [k: string]: unknown;
}

interface DocsResp {
  documents: DocRow[];
  stats: Record<string, number>;
}

interface StanceInfo {
  name: string;
  title?: string;
  [k: string]: unknown;
}

export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  submenu?: { key: string; label: string }[];
}

export interface StanceOpt { name: string; label: string; blacklist?: string[] }

type Face = "library" | "respond";

// ---------- 快捷键（localStorage 可自定义，系统保留键拒绝） ----------
const DEFAULT_KEYS = { switch: "Ctrl+Tab", settings: "Ctrl+,", palette: "Ctrl+K" };
export function loadKeys(): typeof DEFAULT_KEYS {
  try {
    return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem("de.keys") || "{}") };
  } catch { return { ...DEFAULT_KEYS }; }
}
function matchKey(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts[parts.length - 1].toLowerCase();
  const need = { ctrl: parts.includes("Ctrl"), alt: parts.includes("Alt"),
                 shift: parts.includes("Shift") };
  return e.ctrlKey === need.ctrl && e.altKey === need.alt &&
         e.shiftKey === need.shift &&
         (e.key.toLowerCase() === key || (key === "," && e.key === ","));
}

const GESTURE_MIN = 10;    // 低于此位移放行右键菜单
const GESTURE_DONE = 120;  // 达到此位移松手完成切换

// ---------- 自绘线型图标（决策7：禁 emoji、禁现成库；1.4px 描边同族） ----------
const IcoLib = () => (
  <svg width="14" height="14" viewBox="0 0 16 16">
    <path d="M2.5 13.5h11M3 10.5h10M3.5 7.5h9M5 4.5h6" />
  </svg>);
const IcoResp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16">
    <path d="M3 3.5h10v7H8.5L6 13v-2.5H3zM5.5 6h5M5.5 8h3" />
  </svg>);
const IcoGear = () => (
  <svg width="15" height="15" viewBox="0 0 16 16">
    <circle cx="6" cy="5" r="1.6" /><circle cx="10" cy="11" r="1.6" />
    <path d="M2.5 5h1.9M7.6 5h5.9M2.5 11h5.9M11.6 11h1.9" />
  </svg>);
const IcoPalette = () => (
  <svg width="15" height="15" viewBox="0 0 16 16">
    <path d="M3.5 4.5l3.5 3.5-3.5 3.5M8.5 11.5H13" />
  </svg>);
const IcoMin = () => (
  <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3.5 8h9" /></svg>);
const IcoMax = () => (
  <svg width="12" height="12" viewBox="0 0 16 16">
    <rect x="4" y="4" width="8" height="8" rx="1" />
  </svg>);
const IcoRestore = () => (
  <svg width="12" height="12" viewBox="0 0 16 16">
    <path d="M6 5.5V4h6v6h-1.5M4 6h6v6H4z" />
  </svg>);
const IcoClose = () => (
  <svg width="12" height="12" viewBox="0 0 16 16">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>);

function App() {
  const [boot, setBoot] = useState<{ ready: boolean; msg: string; err?: string }>(
    { ready: false, msg: "正在启动本地引擎…" });
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [stances, setStances] = useState<StanceInfo[]>([]);
  const [face, setFace] = useState<Face>("library");
  const [instant, setInstant] = useState(false);      // 快捷键=瞬切零动画
  const [dragX, setDragX] = useState<number | null>(null); // 手势跟手位移
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [tourStep, setTourStep] = useState(() =>
    localStorage.getItem("de.tour") ? -1 : 0);
  const [basketCount, setBasketCount] = useState(0);
  const [basketVersion, setBasketVersion] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [respondPrefill, setRespondPrefill] =
    useState<{ stance?: string; argument?: string }>({});
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const faceRef = useRef<Face>("library");
  faceRef.current = face;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const refreshDocs = useCallback(async () => {
    try {
      const r = await api.get<DocsResp>("/api/knowledge/docs");
      setDocs(r.documents);
      setStats(r.stats);
    } catch (e) {
      notify(`读取知识库失败: ${e}`);
    }
  }, [notify]);

  const refreshBasket = useCallback(async () => {
    try {
      const r = await api.get<{ count: number }>("/api/basket");
      setBasketCount(r.count);
      setBasketVersion((v) => v + 1);
    } catch { /* 引擎未就绪时静默 */ }
  }, []);

  useEffect(() => { initTheme(); }, []);

  // ---------- C6 窗口记忆：默认关；开启时启动恢复位置尺寸，移动/缩放去抖保存 ----------
  useEffect(() => {
    const win = getCurrentWindow();
    if (localStorage.getItem("de.winmem") === "on") {
      try {
        const m = JSON.parse(localStorage.getItem("de.winrect") || "null");
        if (m && m.w >= 960 && m.h >= 600) {
          win.setPosition(new PhysicalPosition(m.x, m.y)).catch(() => {});
          win.setSize(new PhysicalSize(m.w, m.h)).catch(() => {});
        }
      } catch { /* 记忆损坏则忽略，回默认居中 */ }
    }
    let t: number | undefined;
    const save = async () => {
      if (localStorage.getItem("de.winmem") !== "on") return;
      try {
        const pos = await win.outerPosition();
        const size = await win.innerSize();
        localStorage.setItem("de.winrect", JSON.stringify(
          { x: pos.x, y: pos.y, w: size.width, h: size.height }));
      } catch { /* 权限缺失时静默 */ }
    };
    const un1 = win.onMoved(() => {
      window.clearTimeout(t); t = window.setTimeout(save, 500);
    });
    const un2 = win.onResized(() => {
      window.clearTimeout(t); t = window.setTimeout(save, 500);
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    win.isMaximized().then(setMaximized).catch(() => {});
    return () => { un1.then((f) => f()); un2.then((f) => f()); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    waitEngine((msg) => setBoot({ ready: false, msg }))
      .then(async () => {
        setBoot({ ready: true, msg: "" });
        initExternalFonts(engineBase());  // D12 字体外挂
        const s = await api.get<{ stances: StanceInfo[] }>("/api/stances")
          .catch(() => ({ stances: [] as StanceInfo[] }));
        setStances(s.stances);
        refreshDocs();
        refreshBasket();
      })
      .catch((e) => setBoot({ ready: false, msg: "", err: String(e) }));
  }, [refreshDocs, refreshBasket]);

  // ---------- 面切换（含任务栏标题联动） ----------
  const switchFace = useCallback((target?: Face, viaKeyboard = false) => {
    const next = target ?? (faceRef.current === "library" ? "respond" : "library");
    setInstant(viaKeyboard);
    setFace(next);
    getCurrentWindow().setTitle(
      `Debate Engine — ${next === "library" ? "知识库" : "回应"}`).catch(() => {});
  }, []);

  // ---------- 通道 2：长按右键滑动手势 ----------
  useEffect(() => {
    let startX = 0, tracking = false, gesturing = false;
    const invert = () => localStorage.getItem("de.gesture.invert") === "1";
    const enabled = () => localStorage.getItem("de.gesture") !== "off";
    const down = (e: MouseEvent) => {
      if (e.button !== 2 || !enabled()) return;
      startX = e.clientX; tracking = true; gesturing = false;
    };
    const move = (e: MouseEvent) => {
      if (!tracking) return;
      const dx = e.clientX - startX;
      if (!gesturing && Math.abs(dx) >= GESTURE_MIN) gesturing = true;
      if (gesturing) setDragX(Math.max(-160, Math.min(160, dx)));
    };
    const up = (e: MouseEvent) => {
      if (!tracking) return;
      tracking = false;
      if (!gesturing) return;         // <10px：放行右键菜单
      const dx = e.clientX - startX;
      setDragX(null);
      if (Math.abs(dx) >= GESTURE_DONE) {
        // 默认向左滑=去右面（回应），可反转
        const goRight = invert() ? dx > 0 : dx < 0;
        switchFace(goRight ? "respond" : "library");
      }
      gesturing = false;
    };
    const ctx = (e: MouseEvent) => {
      // 手势位移已越过阈值 → 本次右键菜单抑制（三处业务右键菜单不受影响）
      if (gesturing || dragX !== null) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("contextmenu", ctx, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("contextmenu", ctx, true);
    };
  }, [switchFace, dragX]);

  // ---------- 通道 3：快捷键（Ctrl+Tab 瞬切 / Ctrl+, 设置 / Ctrl+K 面板） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = loadKeys();
      if (matchKey(e, keys.switch)) { e.preventDefault(); switchFace(undefined, true); }
      else if (matchKey(e, keys.settings)) { e.preventDefault(); setSettingsOpen((v) => !v); }
      else if (matchKey(e, keys.palette)) { e.preventDefault(); setPaletteOpen((v) => !v); }
      else if (e.key === "Escape") { setSettingsOpen(false); setPaletteOpen(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [switchFace]);

  // ---------- 跨面通道 ----------
  const respondWith = useCallback((argument?: string, stance?: string) => {
    setRespondPrefill({ argument, stance });
    switchFace("respond");
  }, [switchFace]);
  const searchWith = useCallback((q: string) => {
    setLibraryQuery(q);
    switchFace("library");
  }, [switchFace]);

  const stanceOpts: StanceOpt[] = useMemo(() => stances.map((s) => ({
    name: s.name,
    label: (s.title as string)?.replace(/^SKILL[:：]\s*/, "") || s.name,
    blacklist: (s.method_blacklist as string[] | undefined) || [],   // 批 3：笔法兼容
  })), [stances]);

  const win = getCurrentWindow();

  if (!boot.ready) {
    return (
      <div className="shell2">
        <header className="topbar" data-tauri-drag-region>
          <span className="app-mark" data-tauri-drag-region>Debate Engine</span>
          <div className="spacer" data-tauri-drag-region />
          <div className="winctl">
            <button onClick={() => win.minimize()} title="最小化"><IcoMin /></button>
            <button className="win-close" onClick={() => win.close()} title="关闭"><IcoClose /></button>
          </div>
        </header>
        <div className="boot">
          <div className="boot-card">
            <h1>Debate Engine</h1>
            {boot.err
              ? <p className="err">{boot.err}</p>
              : <><div className="spinner" /><p>{boot.msg}</p></>}
          </div>
        </div>
      </div>
    );
  }

  const offset = face === "library" ? 0 : -50;
  const dragOffset = dragX !== null ? (dragX / window.innerWidth) * 50 : 0;

  return (
    <div className="shell2">
      {/* C1/C2 无外框功能条：整条空白带=拖动区，双击=最大化/还原 */}
      <header className="topbar" data-tauri-drag-region
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                win.toggleMaximize().catch(() => {});
              }}>
        <span className="app-mark" data-tauri-drag-region>Debate Engine</span>
        <nav className="face-tabs">
          <button className={face === "library" ? "on" : ""}
                  onClick={() => switchFace("library")}><IcoLib />知识库</button>
          <button className={face === "respond" ? "on" : ""}
                  onClick={() => switchFace("respond")}>
            <IcoResp />回应
            {basketCount > 0 && <span className="badge">{basketCount}</span>}
          </button>
        </nav>
        <span className="caps" data-tauri-drag-region>
          {loadKeys().switch} 切面 · {loadKeys().palette} 面板</span>
        <div className="spacer" data-tauri-drag-region />
        <button className="tb-btn" title={`命令面板（${loadKeys().palette}）`}
                onClick={() => setPaletteOpen(true)}><IcoPalette /></button>
        <button className="tb-btn" title={`设置（${loadKeys().settings}）`}
                onClick={() => setSettingsOpen(true)}><IcoGear /></button>
        <div className="winctl">
          <button onClick={() => win.minimize()} title="最小化"><IcoMin /></button>
          <button onClick={() => win.toggleMaximize()} title={maximized ? "还原" : "最大化"}>
            {maximized ? <IcoRestore /> : <IcoMax />}</button>
          <button className="win-close" onClick={() => win.close()} title="关闭"><IcoClose /></button>
        </div>
      </header>

      <div className="faces-area">
        <div className={"faces" + (instant || dragX !== null ? " no-anim" : "")}
             style={{ transform: `translateX(${offset + dragOffset}%)` }}
             onTransitionEnd={() => setInstant(false)}>
          <section className="face" aria-hidden={face !== "library"}>
            <LibraryFace stances={stanceOpts} docs={docs} stats={stats}
                         active={face === "library"} notify={notify}
                         refreshDocs={refreshDocs} respondWith={respondWith}
                         basketChanged={refreshBasket}
                         externalQuery={libraryQuery} />
          </section>
          <section className="face" aria-hidden={face !== "respond"}>
            <RespondFace stances={stanceOpts} active={face === "respond"}
                         notify={notify} prefill={respondPrefill}
                         basketVersion={basketVersion}
                         basketChanged={refreshBasket}
                         onSaved={refreshDocs} />
          </section>
        </div>
      </div>

      {/* 设置：全屏覆盖浮层 */}
      {settingsOpen && (
        <div className="overlay" onClick={() => setSettingsOpen(false)}>
          <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-head">
              <span>设置</span>
              <button className="link" title="关闭 (Esc)" onClick={() => setSettingsOpen(false)}>
                <svg width="14" height="14" viewBox="0 0 16 16">
                  <path d="M2 8h12 M10 5l4 3-4 3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <SettingsPanel notify={notify} />
          </div>
        </div>
      )}

      {/* Ctrl+K 命令面板（永不可禁用） */}
      {paletteOpen && (
        <Palette close={() => setPaletteOpen(false)} switchFace={switchFace}
                 openSettings={() => setSettingsOpen(true)}
                 searchWith={searchWith} respondWith={respondWith} />
      )}

      {/* 首启三步导览 */}
      {tourStep >= 0 && (
        <div className="overlay tour" onClick={() => {}}>
          <div className="tour-card">
            {tourStep === 0 && <>
              <h3>知识库面</h3>
              <p>导入资料、检索、图谱 / 逻辑链 / 脉络可视化都在这一面。旧版「搜索 / 导入 / 图谱 / 溯源」已合并于此。</p>
            </>}
            {tourStep === 1 && <>
              <h3>顶部功能条</h3>
              <p>窗口外框已收进这条功能条：拖空白处移动窗口、双击最大化。点「知识库 / 回应」切面；也可以 <b>{loadKeys().switch}</b> 瞬切，或按住右键左右滑动。</p>
            </>}
            {tourStep === 2 && <>
              <h3>回应面</h3>
              <p>输入对方言论，选择风格（反驳 / 批判性分析 / 评价等 14 种笔法）生成带引用的回答。知识库面收集的素材进左侧素材组，勾选注入生成。</p>
            </>}
            <div className="tour-nav">
              <span className="muted">{tourStep + 1} / 3</span>
              <button className="primary" onClick={() => {
                if (tourStep >= 2) { localStorage.setItem("de.tour", "1"); setTourStep(-1); }
                else setTourStep(tourStep + 1);
              }}>{tourStep >= 2 ? "开始使用" : "下一步"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ---------- 命令面板 ----------
function Palette({ close, switchFace, openSettings, searchWith, respondWith }: {
  close: () => void;
  switchFace: (f?: Face, k?: boolean) => void;
  openSettings: () => void;
  searchWith: (q: string) => void;
  respondWith: (argument?: string) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const cmds = [
    { key: "lib", label: "切到：知识库面", run: () => switchFace("library", true) },
    { key: "resp", label: "切到：回应面", run: () => switchFace("respond", true) },
    { key: "search", label: q ? `搜索：「${q}」` : "全局搜索…（输入关键词）",
      run: () => q && searchWith(q) },
    { key: "rebut", label: q ? `回应：「${q}」` : "发起回应…（输入对方论点）",
      run: () => q && respondWith(q) },
    { key: "settings", label: "打开设置", run: openSettings },
  ];
  const visible = cmds.filter((c) => !q || c.label.includes(q) ||
                              c.key === "search" || c.key === "rebut");
  return (
    <div className="overlay" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} placeholder="输入命令、搜索词或对方论点…"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter" && visible[0]) { visible[0].run(); close(); }
                 if (e.key === "Escape") close();
               }} />
        <div className="palette-list">
          {visible.map((c) => (
            <div key={c.key} className="palette-item"
                 onClick={() => { c.run(); close(); }}>{c.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
