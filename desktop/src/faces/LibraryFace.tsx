// 知识库面（PLAN-0.1.2 项目10/11/12/13/15）：
// 顶部检索区（段落/论点/脉络三视角，搜索+溯源合并）+ 左立场树 +
// 中画布五投影（馆藏/图谱/逻辑链/脉络/对比）+ 右档案卡 + 右键菜单。
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { DocRow, StanceOpt } from "../App";
import ComparePanel from "../panels/ComparePanel";
import GraphPanel from "../panels/GraphPanel";
import ImportPanel from "../panels/ImportPanel";
import ChainView from "../views/ChainView";
import TimelineView from "../views/TimelineView";

interface Chunk { chunk_id: string; doc_id: string; text: string;
                  score?: number; [k: string]: unknown }
interface TraceRow { arg_id: string; claim?: string; thinker?: string;
                     school?: string; doc_id: string; doc_title?: string;
                     year?: number; similarity: number }

interface Props {
  stances: StanceOpt[];
  docs: DocRow[];
  stats: Record<string, number>;
  active: boolean;
  notify: (msg: string) => void;
  refreshDocs: () => void;
  respondWith: (argument?: string, stance?: string) => void;
  basketChanged: () => void;
  externalQuery: string;
}

const VIEWS = [
  { key: "collection", label: "馆藏" },
  { key: "graph", label: "图谱" },
  { key: "chain", label: "逻辑链" },
  { key: "timeline", label: "脉络" },
  { key: "compare", label: "对比" },
] as const;

export default function LibraryFace({
  stances, docs, stats, active, notify, refreshDocs,
  respondWith, basketChanged, externalQuery,
}: Props) {
  const [view, setView] = useState<string>("collection");
  const [q, setQ] = useState("");
  const [searchTab, setSearchTab] = useState<"para" | "units" | "era">("para");
  const [fStance, setFStance] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [paraHits, setParaHits] = useState<Chunk[] | null>(null);
  const [unitHits, setUnitHits] = useState<TraceRow[] | null>(null);
  const [speculation, setSpeculation] = useState("");
  const [searching, setSearching] = useState(false);
  const [dossier, setDossier] = useState<DocRow | null>(null);
  const [preview, setPreview] = useState<ReactNode>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; doc: DocRow } | null>(null);
  const [chainAnchor, setChainAnchor] = useState("");
  const [compareList, setCompareList] = useState<DocRow[]>([]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const stanceLabel = useCallback((key: string) =>
    stances.find((s) => s.name === key)?.label || key || "未分类", [stances]);

  // ---------- 检索：一次查询双路并发（段落 + 论点/脉络） ----------
  const runSearch = useCallback(async (term?: string) => {
    const query = (term ?? q).trim();
    if (!query) { setParaHits(null); setUnitHits(null); return; }
    setSearching(true);
    try {
      const [para, trace] = await Promise.all([
        api.get<{ results: Chunk[] }>(
          `/api/knowledge/search?q=${encodeURIComponent(query)}` +
          `&stance=${fStance || "empirical"}&mode=hybrid&top_k=8`)
          .catch(() => ({ results: [] as Chunk[] })),
        api.post<{ chain: TraceRow[]; speculation: string }>(
          "/api/analysis/trace",
          { claim: query, stance: fStance || null,
            year_from: yearFrom ? Number(yearFrom) : null,
            year_to: yearTo ? Number(yearTo) : null })
          .catch(() => ({ chain: [] as TraceRow[], speculation: "" })),
      ]);
      setParaHits(para.results);
      setUnitHits(trace.chain);
      setSpeculation(trace.speculation);
    } finally {
      setSearching(false);
    }
  }, [q, fStance, yearFrom, yearTo]);

  // 命令面板「全局搜索」落点
  useEffect(() => {
    if (externalQuery) { setQ(externalQuery); runSearch(externalQuery); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuery]);

  const addBasket = useCallback(async (
    type: "chunk" | "arg_unit" | "document", refId: string,
    excerpt: string, source: string) => {
    try {
      const r = await api.post<{ duplicated: boolean }>("/api/basket",
        { item_type: type, ref_id: refId, excerpt, source });
      notify(r.duplicated ? "已在素材篮中" : "已加入素材篮");
      basketChanged();
    } catch (e) {
      notify(`加入失败: ${e}`);
    }
  }, [notify, basketChanged]);

  const showDossier = useCallback(async (doc: DocRow) => {
    setDossier(doc);
    setPreview(<div className="muted">加载预览…</div>);
    try {
      const r = await api.get<{ markdown: string }>(
        `/api/knowledge/docs/${doc.doc_id}/preview`);
      setPreview(<pre className="md-preview">{r.markdown}</pre>);
    } catch (e) {
      setPreview(<div className="err">预览失败: {String(e)}</div>);
    }
  }, []);

  // ---------- 右键菜单动作 ----------
  const onMenuAction = useCallback(async (action: string, doc: DocRow, sub?: string) => {
    setMenu(null);
    if (action === "reassign" && sub) {
      try {
        await api.patch(`/api/knowledge/docs/${doc.doc_id}/stance`, { stance: sub });
        notify(`已移至「${stanceLabel(sub)}」`);
        refreshDocs();
      } catch (e) { notify(`改分类失败: ${e}`); }
    } else if (action === "as-source") {
      respondWith(undefined, doc.stance);
      notify(`已切到回应面（立场：${stanceLabel(doc.stance || "")}）`);
    } else if (action === "basket") {
      addBasket("document", doc.doc_id,
                doc.summary || doc.title || doc.doc_id, doc.title || doc.doc_id);
    } else if (action === "compare") {
      setCompareList((prev) => prev.some((d) => d.doc_id === doc.doc_id)
        ? prev : [...prev, doc]);
      setView("compare");
      notify("已加入对比（图景 · 对比投影）");
    } else if (action === "chain") {
      setChainAnchor(doc.title || doc.doc_id);
      setView("chain");
    } else if (action === "delete") {
      if (!window.confirm(`确定删除「${doc.title || doc.doc_id}」？\n将级联清除章节、切块、向量与归档文件。`)) return;
      try {
        await api.del(`/api/import/${doc.doc_id}`);
        notify("已删除");
        if (dossier?.doc_id === doc.doc_id) { setDossier(null); setPreview(null); }
        refreshDocs();
      } catch (e) { notify(`删除失败: ${e}`); }
    }
  }, [notify, refreshDocs, stanceLabel, respondWith, addBasket, dossier]);

  const groups = useMemo(() => {
    const g = new Map<string, DocRow[]>();
    for (const d of docs) {
      const k = d.stance || "";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(d);
    }
    return g;
  }, [docs]);

  const hasSearch = paraHits !== null || unitHits !== null;

  return (
    <div className="lib-face">
      {/* 顶部全局检索区 */}
      <div className="lib-search">
        <input className="search-input" value={q} placeholder="检索知识库：一次查询，段落 / 论点 / 脉络三视角（Enter 执行，Esc 清空）"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter") runSearch();
                 if (e.key === "Escape") { setQ(""); setParaHits(null); setUnitHits(null); }
               }} />
        <select value={fStance} onChange={(e) => setFStance(e.target.value)}>
          <option value="">全部立场</option>
          {stances.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
        </select>
        <input className="year-input" value={yearFrom} placeholder="起始年"
               onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, ""))} />
        <input className="year-input" value={yearTo} placeholder="截止年"
               onChange={(e) => setYearTo(e.target.value.replace(/\D/g, ""))} />
        <button className="primary" disabled={searching} onClick={() => runSearch()}>
          {searching ? "检索中…" : "检索"}
        </button>
      </div>

      <div className="lib-body">
        {/* 左栏：统计头 + 立场树 */}
        <aside className="lib-left">
          <div className="stat-head">
            <div className="stat"><b>{stats.documents ?? 0}</b><span>文档</span></div>
            <div className="stat"><b>{stats.chunks ?? 0}</b><span>切块</span></div>
            <div className="stat"><b>{stats.arg_units ?? 0}</b><span>论证单元</span></div>
          </div>
          <div className="tree">
            {docs.length === 0 && (
              <div className="empty-state">
                <p>知识库还是空的</p>
                <button className="link" onClick={() => setView("collection")}>
                  去「馆藏」导入第一篇文档 →</button>
              </div>
            )}
            {[...groups.entries()].map(([st, list]) => (
              <div key={st || "none"} className="tree-group">
                <div className="tree-stance">
                  <i className="stance-dot" data-stance={st} />
                  {stanceLabel(st)} <span className="muted">({list.length})</span>
                </div>
                {list.map((d) => (
                  <div key={d.doc_id}
                       className={"tree-doc" + (dossier?.doc_id === d.doc_id ? " sel" : "")}
                       title={d.summary || ""}
                       onClick={() => showDossier(d)}
                       onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, doc: d }); }}>
                    {d.title || d.doc_id}
                    {(d as { origin?: string }).origin === "self" && <span className="self-tag">自产</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* 中央：检索结果 或 画布投影 */}
        <main className="lib-center">
          {hasSearch ? (
            <div className="search-results">
              <div className="seg">
                {(["para", "units", "era"] as const).map((t) => (
                  <button key={t} className={searchTab === t ? "seg-on" : ""}
                          onClick={() => setSearchTab(t)}>
                    {t === "para" ? `段落 ${paraHits?.length ?? 0}`
                      : t === "units" ? `论点 ${unitHits?.length ?? 0}` : "脉络"}
                  </button>
                ))}
                <div className="spacer" />
                <button className="link" onClick={() => { setParaHits(null); setUnitHits(null); }}>
                  返回画布 ×</button>
              </div>
              {searchTab === "para" && (
                <div className="ledger">
                  {(paraHits ?? []).map((c) => (
                    <div key={c.chunk_id} className="ledger-row">
                      <div className="ledger-text">{c.text.slice(0, 260)}</div>
                      <div className="ledger-meta">
                        <span className="muted">{docs.find((d) => d.doc_id === c.doc_id)?.title || c.doc_id}</span>
                        <button className="link" onClick={() => {
                          const d = docs.find((x) => x.doc_id === c.doc_id);
                          if (d) showDossier(d);
                        }}>查看原文</button>
                        <button className="link" onClick={() =>
                          addBasket("chunk", c.chunk_id, c.text.slice(0, 400),
                                    docs.find((d) => d.doc_id === c.doc_id)?.title || c.doc_id)}>
                          加入素材篮</button>
                      </div>
                    </div>
                  ))}
                  {paraHits?.length === 0 && <div className="empty-state"><p>没有命中的段落，换个说法试试</p></div>}
                </div>
              )}
              {searchTab === "units" && (
                <div className="ledger">
                  {(unitHits ?? []).map((r) => (
                    <div key={r.arg_id} className="ledger-row">
                      <div className="ledger-text">{r.claim}</div>
                      <div className="ledger-meta">
                        <span className="muted">{r.thinker || "—"} · {r.doc_title || r.doc_id} · {r.year ?? "年代不详"}</span>
                        <button className="link" onClick={() => { setChainAnchor(r.claim || ""); setView("chain"); setParaHits(null); setUnitHits(null); }}>看逻辑链</button>
                        <button className="link" onClick={() =>
                          addBasket("arg_unit", r.arg_id, r.claim || "", r.thinker || r.doc_title || "")}>
                          加入素材篮</button>
                      </div>
                    </div>
                  ))}
                  {unitHits?.length === 0 && <div className="empty-state"><p>没有相近的论证单元（文档需先完成深度分析）</p></div>}
                  {speculation && (
                    <div className="speculation">
                      <span className="spec-tag">模型推测 · 未经库内文献佐证</span>
                      <p>{speculation}</p>
                    </div>
                  )}
                </div>
              )}
              {searchTab === "era" && (
                <TimelineView rows={unitHits ?? []} docs={docs} notify={notify} />
              )}
            </div>
          ) : (
            <>
              <div className="seg view-seg">
                {VIEWS.map((v) => (
                  <button key={v.key} className={view === v.key ? "seg-on" : ""}
                          onClick={() => setView(v.key)}>{v.label}</button>
                ))}
              </div>
              <div className="lib-canvas">
                {view === "collection" && (
                  <ImportPanel stances={stances} notify={notify} onDone={refreshDocs} />
                )}
                {view === "graph" && (
                  <GraphPanel stances={stances} docs={docs} notify={notify}
                              active={active && view === "graph"}
                              onChain={(anchor) => { setChainAnchor(anchor); setView("chain"); }} />
                )}
                {view === "chain" && (
                  <ChainView stances={stances} anchor={chainAnchor}
                             setAnchor={setChainAnchor} notify={notify} />
                )}
                {view === "timeline" && (
                  <TimelineView rows={null} docs={docs} notify={notify} />
                )}
                {view === "compare" && (
                  <ComparePanel stances={stances} docs={docs}
                                compareList={compareList} notify={notify} />
                )}
              </div>
            </>
          )}
        </main>

        {/* 右栏：档案卡 */}
        {dossier && (
          <aside className="lib-right">
            <div className="dossier-head">
              <span>{dossier.title || dossier.doc_id}</span>
              <button className="link" onClick={() => { setDossier(null); setPreview(null); }}>×</button>
            </div>
            <div className="dossier-meta">
              <div><span className="muted">立场</span> {stanceLabel(dossier.stance || "")}</div>
              {dossier.author ? <div><span className="muted">作者</span> {String(dossier.author)}</div> : null}
              {dossier.summary ? <div className="dossier-summary">{String(dossier.summary)}</div> : null}
              <div className="dossier-actions">
                <button className="link" onClick={() => respondWith(undefined, dossier.stance)}>作为回应立场</button>
                <button className="link" onClick={() =>
                  addBasket("document", dossier.doc_id,
                            dossier.summary || dossier.title || dossier.doc_id,
                            dossier.title || dossier.doc_id)}>加入素材篮</button>
              </div>
            </div>
            <div className="side-body">{preview}</div>
          </aside>
        )}
      </div>

      {/* 右键菜单 */}
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}
             onClick={(e) => e.stopPropagation()}>
          {[
            { key: "reassign", label: "修改分类",
              submenu: stances.map((s) => ({ key: s.name, label: s.label })) },
            { key: "as-source", label: "作为回应立场" },
            { key: "basket", label: "加入素材篮" },
            { key: "compare", label: "加入对比" },
            { key: "chain", label: "查看逻辑链" },
            { key: "delete", label: "删除文档", danger: true },
          ].map((it) => (
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
    </div>
  );
}
