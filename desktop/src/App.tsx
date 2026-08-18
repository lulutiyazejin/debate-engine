// 双面骨架（PLAN-0.1.2 项目7/8/9/24）：知识库面 ⇄ 回应面，全屏互斥。
// 切换四通道：右上悬浮组 / 长按右键滑动(≥120px) / Ctrl+Tab(瞬切) / Ctrl+K 命令面板。
// 设置 = 全屏覆盖浮层（不是第三个面）；两面常驻挂载不卸载。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, waitEngine } from "./api";
import LibraryFace from "./faces/LibraryFace";
import RespondFace from "./faces/RespondFace";
import SettingsPanel from "./panels/SettingsPanel";
import { initTheme } from "./theme";
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

export interface StanceOpt { name: string; label: string }

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
  const [tourStep, setTourStep] = useState(() =>
    localStorage.getItem("de.tour") ? -1 : 0);
  const [floatOn, setFloatOn] = useState(() =>
    localStorage.getItem("de.float") !== "off");
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

  useEffect(() => {
    waitEngine((msg) => setBoot({ ready: false, msg }))
      .then(async () => {
        setBoot({ ready: true, msg: "" });
        const s = await api.get<{ stances: StanceInfo[] }>("/api/stances")
          .catch(() => ({ stances: [] as StanceInfo[] }));
        setStances(s.stances);
        refreshDocs();
        refreshBasket();
      })
      .catch((e) => setBoot({ ready: false, msg: "", err: String(e) }));
  }, [refreshDocs, refreshBasket]);

  // ---------- 面切换（含窗口标题联动） ----------
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
  })), [stances]);

  if (!boot.ready) {
    return (
      <div className="boot">
        <div className="boot-card">
          <h1>Debate Engine</h1>
          {boot.err
            ? <p className="err">{boot.err}</p>
            : <><div className="spinner" /><p>{boot.msg}</p></>}
        </div>
      </div>
    );
  }

  const offset = face === "library" ? 0 : -50;
  const dragOffset = dragX !== null ? (dragX / window.innerWidth) * 50 : 0;

  return (
    <div className="shell2">
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

      {/* 悬浮组：主钮=切面（显示对面图标+素材篮角标），副钮=设置 */}
      {floatOn && (
        <div className="float-group">
          <button className="float-main" onClick={() => switchFace()}
                  title={`切换到${face === "library" ? "回应" : "知识库"}（${loadKeys().switch}）`}>
            {face === "library" ? "⚔" : "🗄"}
            {basketCount > 0 && <span className="badge">{basketCount}</span>}
          </button>
          <button className="float-gear" onClick={() => setSettingsOpen(true)}
                  title={`设置（${loadKeys().settings}）`}>⚙</button>
        </div>
      )}

      {/* 设置：全屏覆盖浮层 */}
      {settingsOpen && (
        <div className="overlay" onClick={() => setSettingsOpen(false)}>
          <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-head">
              <span>设置</span>
              <button className="link" onClick={() => setSettingsOpen(false)}>关闭 (Esc)</button>
            </div>
            <SettingsPanel notify={notify}
                           floatOn={floatOn}
                           setFloatOn={(v) => {
                             setFloatOn(v);
                             localStorage.setItem("de.float", v ? "on" : "off");
                             if (!v) notify(
                               `悬浮按钮已隐藏。随时可用 ${loadKeys().switch} 切面、` +
                               `${loadKeys().settings} 打开设置、${loadKeys().palette} 命令面板`);
                           }} />
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
              <h3>🗄 知识库面</h3>
              <p>导入资料、检索、图谱 / 逻辑链 / 脉络可视化都在这一面。旧版「搜索 / 导入 / 图谱 / 溯源」已合并于此。</p>
            </>}
            {tourStep === 1 && <>
              <h3>右上悬浮按钮</h3>
              <p>点击切换两面；也可以 <b>{loadKeys().switch}</b> 瞬切，或按住右键左右滑动（超过一定距离生效）。</p>
            </>}
            {tourStep === 2 && <>
              <h3>⚔ 回应面</h3>
              <p>输入对方言论，选择意图（反驳 / 批判 / 评价 / 分析 / 综合报告）生成带引用的回应。知识库面收集的素材会进入左侧素材篮。</p>
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
    { key: "lib", label: "切到：🗄 知识库面", run: () => switchFace("library", true) },
    { key: "resp", label: "切到：⚔ 回应面", run: () => switchFace("respond", true) },
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
