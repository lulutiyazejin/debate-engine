// 主框架（项目11/12）：启动门 → 三栏布局
// 左=知识库树（立场分组）· 中=可插拔 tab 面板 · 右=引用/详情侧栏
// 右键菜单为注册式：本版注册 修改分类/用作反驳来源/加入对比/删除文档
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, waitEngine } from "./api";
import ImportPanel from "./panels/ImportPanel";
import RebutPanel from "./panels/RebutPanel";
import SearchPanel from "./panels/SearchPanel";
import SettingsPanel from "./panels/SettingsPanel";
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

// ---------- 右键菜单注册表（供图谱/对比等后续面板追加注册项） ----------
export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  submenu?: { key: string; label: string }[];
}

function App() {
  const [boot, setBoot] = useState<{ ready: boolean; msg: string; err?: string }>(
    { ready: false, msg: "正在启动本地引擎…" });
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [stances, setStances] = useState<StanceInfo[]>([]);
  const [tab, setTab] = useState("rebut");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // 右栏内容：doc 预览 或 反驳引用（由面板通过 setSide 推送）
  const [side, setSide] = useState<{ title: string; body: ReactNode } | null>(null);
  const [compareList, setCompareList] = useState<DocRow[]>([]);
  const [rebutPrefill, setRebutPrefill] = useState<{ stance?: string; argument?: string }>({});
  const [menu, setMenu] = useState<{ x: number; y: number; doc: DocRow } | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

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

  useEffect(() => {
    waitEngine((msg) => setBoot({ ready: false, msg }))
      .then(async () => {
        setBoot({ ready: true, msg: "" });
        const s = await api.get<{ stances: StanceInfo[] }>("/api/stances")
          .catch(() => ({ stances: [] as StanceInfo[] }));
        setStances(s.stances);
        refreshDocs();
      })
      .catch((e) => setBoot({ ready: false, msg: "", err: String(e) }));
  }, [refreshDocs]);

  // 全局点击关闭右键菜单
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const stanceLabel = useCallback((key: string) => {
    const s = stances.find((x) => x.name === key);
    // skill 标题形如「SKILL: 古典自由主义立场」，去前缀后展示
    return (s?.title as string)?.replace(/^SKILL[:：]\s*/, "") || key || "未分类";
  }, [stances]);

  const showDocPreview = useCallback(async (doc: DocRow) => {
    setRightOpen(true);
    setSide({
      title: doc.title || doc.doc_id,
      body: <div className="muted">加载预览…</div>,
    });
    try {
      const r = await api.get<{ markdown: string }>(
        `/api/knowledge/docs/${doc.doc_id}/preview`);
      setSide({
        title: doc.title || doc.doc_id,
        body: <pre className="md-preview">{r.markdown}</pre>,
      });
    } catch (e) {
      setSide({ title: doc.title || doc.doc_id,
                body: <div className="err">预览失败: {String(e)}</div> });
    }
  }, []);

  // ---------- 右键菜单动作 ----------
  const menuItems: MenuItem[] = useMemo(() => [
    { key: "reassign", label: "修改分类",
      submenu: stances.map((s) => ({ key: s.name, label: (s.title as string)?.replace(/^SKILL[:：]\s*/, "") || s.name })) },
    { key: "as-source", label: "用作反驳来源" },
    { key: "compare", label: "加入对比" },
    { key: "delete", label: "删除文档", danger: true },
  ], [stances]);

  const onMenuAction = useCallback(async (action: string, doc: DocRow, sub?: string) => {
    setMenu(null);
    if (action === "reassign" && sub) {
      try {
        await api.patch(`/api/knowledge/docs/${doc.doc_id}/stance`, { stance: sub });
        notify(`已移至「${stanceLabel(sub)}」`);
        refreshDocs();
      } catch (e) {
        notify(`改分类失败: ${e}`);
      }
    } else if (action === "as-source") {
      setRebutPrefill({ stance: doc.stance });
      setTab("rebut");
      notify(`反驳立场已切到「${stanceLabel(doc.stance || "")}」（${doc.title || doc.doc_id}）`);
    } else if (action === "compare") {
      setCompareList((prev) => prev.some((d) => d.doc_id === doc.doc_id)
        ? prev : [...prev, doc]);
      notify("已加入对比清单（对比视图随对齐引擎面板提供）");
    } else if (action === "delete") {
      if (!window.confirm(`确定删除「${doc.title || doc.doc_id}」？\n将级联清除章节、切块、向量与归档文件。`)) return;
      try {
        await api.del(`/api/import/${doc.doc_id}`);
        notify("已删除");
        refreshDocs();
      } catch (e) {
        notify(`删除失败: ${e}`);
      }
    }
  }, [notify, refreshDocs, stanceLabel]);

  // 下发面板的立场选项：统一清洗成 {name, label}
  const stanceOpts = useMemo(() => stances.map((s) => ({
    name: s.name,
    label: (s.title as string)?.replace(/^SKILL[:：]\s*/, "") || s.name,
  })), [stances]);

  // ---------- 可插拔 tab 注册表（图谱/对比/报告后续批次在此追加） ----------
  const tabs = useMemo(() => [
    { key: "rebut", label: "反驳",
      el: <RebutPanel stances={stanceOpts} prefill={rebutPrefill} setSide={setSide}
                      setRightOpen={setRightOpen} notify={notify} /> },
    { key: "search", label: "搜索",
      el: <SearchPanel stances={stanceOpts} docs={docs} setSide={setSide}
                       setRightOpen={setRightOpen} notify={notify} /> },
    { key: "import", label: "导入",
      el: <ImportPanel stances={stanceOpts} notify={notify} onDone={refreshDocs} /> },
    { key: "settings", label: "设置",
      el: <SettingsPanel notify={notify} /> },
  ], [stanceOpts, docs, rebutPrefill, notify, refreshDocs]);

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

  // 文档按立场分组
  const groups = new Map<string, DocRow[]>();
  for (const d of docs) {
    const k = d.stance || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }

  return (
    <div className="shell">
      {leftOpen && (
        <aside className="col-left">
          <div className="col-head">
            <span>知识库</span>
            <span className="muted small">{stats.documents ?? 0} 文档 · {stats.chunks ?? 0} 块</span>
          </div>
          <div className="tree">
            {docs.length === 0 && <div className="muted pad">尚无文档，去「导入」页添加</div>}
            {[...groups.entries()].map(([st, list]) => (
              <div key={st || "none"} className="tree-group">
                <div className="tree-stance">{stanceLabel(st)} <span className="muted">({list.length})</span></div>
                {list.map((d) => (
                  <div key={d.doc_id} className="tree-doc" title={d.summary || ""}
                       onClick={() => showDocPreview(d)}
                       onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, doc: d }); }}>
                    {d.title || d.doc_id}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {compareList.length > 0 && (
            <div className="compare-tray">
              对比清单：{compareList.length} 篇
              <button className="link" onClick={() => setCompareList([])}>清空</button>
            </div>
          )}
        </aside>
      )}

      <main className="col-center">
        <div className="tabbar">
          <button className="fold" onClick={() => setLeftOpen(!leftOpen)}
                  title={leftOpen ? "折叠左栏" : "展开左栏"}>{leftOpen ? "⟨" : "⟩"}</button>
          {tabs.map((t) => (
            <button key={t.key} className={tab === t.key ? "tab active" : "tab"}
                    onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
          <div className="spacer" />
          <button className="fold" onClick={() => setRightOpen(!rightOpen)}
                  title={rightOpen ? "折叠右栏" : "展开右栏"}>{rightOpen ? "⟩" : "⟨"}</button>
        </div>
        <div className="panel-host">
          {tabs.map((t) => (
            <div key={t.key} style={{ display: tab === t.key ? "block" : "none", height: "100%" }}>
              {t.el}
            </div>
          ))}
        </div>
      </main>

      {rightOpen && (
        <aside className="col-right">
          <div className="col-head">{side?.title || "详情"}</div>
          <div className="side-body">
            {side?.body || <div className="muted pad">点击左侧文档看预览；生成反驳后这里显示引用来源</div>}
          </div>
        </aside>
      )}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}
             onClick={(e) => e.stopPropagation()}>
          {menuItems.map((it) => (
            <div key={it.key} className={"ctx-item" + (it.danger ? " danger" : "")}
                 onClick={() => !it.submenu && onMenuAction(it.key, menu.doc)}>
              {it.label}{it.submenu && " ▸"}
              {it.submenu && (
                <div className="ctx-sub">
                  {it.submenu.map((s) => (
                    <div key={s.key} className="ctx-item"
                         onClick={(e) => { e.stopPropagation(); onMenuAction(it.key, menu.doc, s.key); }}>
                      {s.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
