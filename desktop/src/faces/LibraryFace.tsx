// 知识库面（PLAN-0.1.2 项目10/11/12/13/15）：
// 顶部检索区（段落/论点/脉络三视角，搜索+溯源合并）+ 左立场树 +
// 中画布五投影（馆藏/图谱/逻辑链/脉络/对比）+ 右档案卡 + 右键菜单。
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { DocRow, StanceOpt } from "../App";
import Combobox, { Hl } from "../components/Combobox";
import DocTree from "../components/DocTree";
import ReaderModal from "../components/ReaderModal";
import SegmentedSlider from "../components/SegmentedSlider";
import ComparePanel from "../panels/ComparePanel";
import VizPanel from "../panels/VizPanel";
import ImportPanel from "../panels/ImportPanel";
import ChainView from "../views/ChainView";
import TimelineView from "../views/TimelineView";
import ArchiveView from "../views/ArchiveView";

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
  { key: "archive", label: "档案" },   // 0.1.5 D4
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

  // 批 2：分组逻辑已随文档树迁入 DocTree 组件

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
    excerpt: string, source: string, groupId?: number) => {
    try {
      const r = await api.post<{ duplicated: boolean }>("/api/basket",
        { item_type: type, ref_id: refId, excerpt, source,
          group_id: groupId ?? null });
      notify(r.duplicated ? "已在素材组中" : "已加入素材组");
      basketChanged();
    } catch (e) {
      notify(`加入失败: ${e}`);
    }
  }, [notify, basketChanged]);

  // 批 4：组列表（右键子菜单用）
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  // 0.1.4 批 6：阅读器开关（doc_id）
  const [readerDoc, setReaderDoc] = useState<string | null>(null);
  useEffect(() => {
    if (active) {
      api.get<{ groups: { id: number; name: string }[] }>("/api/groups")
        .then((r) => setGroups(r.groups)).catch(() => {});
    }
  }, [active]);

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
      // 批 4：子菜单选组（sub=组 id）；无 sub 时落公共组
      addBasket("document", doc.doc_id,
                doc.summary || doc.title || doc.doc_id, doc.title || doc.doc_id,
                sub ? Number(sub) : undefined);
    } else if (action === "compare") {
      setCompareList((prev) => prev.some((d) => d.doc_id === doc.doc_id)
        ? prev : [...prev, doc]);
      setView("compare");
      notify("已加入对比（图景 · 对比投影）");
    } else if (action === "chain") {
      setChainAnchor(doc.title || doc.doc_id);
      setView("chain");
    } else if (action === "read") {
      setReaderDoc(doc.doc_id);   // 0.1.4 批 6：统一阅读器
    } else if (action === "resummarize") {
      // 0.1.5 I3：补生成摘要（回写 documents.summary + 档案 md + INDEX）
      notify("补生成摘要中…");
      try {
        await api.post(`/api/knowledge/docs/${doc.doc_id}/resummarize`, {});
        notify("摘要已补生成并回写档案");
        refreshDocs();
        if (dossier?.doc_id === doc.doc_id) showDossier(doc);
      } catch (e) { notify(`补摘要失败: ${e}`); }
    } else if (action === "delete") {
      if (!window.confirm(`确定删除「${doc.title || doc.doc_id}」？\n将级联清除章节、切块、向量；档案库归档默认保留。`)) return;
      try {
        await api.del(`/api/import/${doc.doc_id}`);
        notify("已删除");
        if (dossier?.doc_id === doc.doc_id) { setDossier(null); setPreview(null); }
        refreshDocs();
      } catch (e) { notify(`删除失败: ${e}`); }
    }
  }, [notify, refreshDocs, stanceLabel, respondWith, addBasket, dossier,
      showDossier]);

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
        <Combobox width={170} value={fStance} onChange={setFStance}
                  placeholder="全部立场" scopeLabel="立场名"
                  options={[{ value: "", label: "全部立场" },
                            ...stances.map((s) => ({ value: s.name, label: s.label }))]} />
        <input className="year-input" value={yearFrom} placeholder="起始年"
               onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, ""))} />
        <input className="year-input" value={yearTo} placeholder="截止年"
               onChange={(e) => setYearTo(e.target.value.replace(/\D/g, ""))} />
        <button className="primary" disabled={searching} onClick={() => runSearch()}>
          {searching ? "检索中…" : "检索"}
        </button>
      </div>

      <div className="lib-body">
        {/* 批 2/项目 22：常驻左栏已退役，文档树迁入馆藏主从布局 */}

        {/* 中央：检索结果 或 画布投影 */}
        <main className="lib-center">
          {hasSearch ? (
            <div className="search-results">
              {/* 0.1.5 J7：检索三视角改滑移分段器 */}
              <div className="seg-row">
                <SegmentedSlider value={searchTab}
                  onChange={(k) => setSearchTab(k as typeof searchTab)}
                  options={[
                    { key: "para", label: `段落 ${paraHits?.length ?? 0}` },
                    { key: "units", label: `论点 ${unitHits?.length ?? 0}` },
                    { key: "era", label: "脉络" },
                  ]} />
                <div className="spacer" />
                <button className="link" onClick={() => { setParaHits(null); setUnitHits(null); }}>
                  返回画布 ×</button>
              </div>
              {searchTab === "para" && (
                <div className="ledger">
                  {(paraHits ?? []).map((c) => (
                    <div key={c.chunk_id} className="ledger-row">
                      <div className="ledger-text"><Hl text={c.text.slice(0, 260)} query={q} /></div>
                      <div className="ledger-meta">
                        <span className="muted">{docs.find((d) => d.doc_id === c.doc_id)?.title || c.doc_id}</span>
                        <button className="link" onClick={() => {
                          const d = docs.find((x) => x.doc_id === c.doc_id);
                          if (d) showDossier(d);
                        }}>查看原文</button>
                        <button className="link" onClick={() =>
                          addBasket("chunk", c.chunk_id, c.text.slice(0, 400),
                                    docs.find((d) => d.doc_id === c.doc_id)?.title || c.doc_id)}>
                          加入素材组</button>
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
                      <div className="ledger-text"><Hl text={r.claim || ""} query={q} /></div>
                      <div className="ledger-meta">
                        <span className="muted">{r.thinker || "—"} · {r.doc_title || r.doc_id} · {r.year ?? "年代不详"}</span>
                        <button className="link" onClick={() => { setChainAnchor(r.claim || ""); setView("chain"); setParaHits(null); setUnitHits(null); }}>看逻辑链</button>
                        <button className="link" onClick={() =>
                          addBasket("arg_unit", r.arg_id, r.claim || "", r.thinker || r.doc_title || "")}>
                          加入素材组</button>
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
              {/* 0.1.5 J7：馆藏五段改滑移分段器（120ms 固定时长，键盘 ←→ 可切） */}
              <div className="seg-row view-seg">
                <SegmentedSlider value={view} onChange={setView}
                  options={VIEWS.map((v) => ({ key: v.key, label: v.label }))} />
              </div>
              <div className="lib-canvas">
                {/* 0.1.5 I1：五视图 always-mount + 显隐切换（display:contents/none），
                    导入 busy/预览切面不丢；graph 离面 pauseAnimation 由 active 控 */}
                <div style={{ display: view === "collection" ? "contents" : "none" }}>
                  <div className="coll-split">
                    {/* 批 2/项目 22：文档树收进馆藏主从布局，知识库面去常驻左栏 */}
                    <aside className="coll-tree">
                      <DocTree docs={docs} stances={stances} stats={stats}
                               selectedId={dossier?.doc_id}
                               onSelect={showDossier}
                               onContext={(e, d) => setMenu({ x: e.clientX, y: e.clientY, doc: d })} />
                    </aside>
                    <div className="coll-main">
                      <ImportPanel stances={stances} notify={notify} onDone={refreshDocs}
                                   active={active && view === "collection"} />
                    </div>
                  </div>
                </div>
                <div style={{ display: view === "graph" ? "contents" : "none" }}>
                  {/* 0.1.5 批 5：图谱区升级五段子投影（力导向/3D立方/散点/雷达/交叉） */}
                  <VizPanel stances={stances} docs={docs} notify={notify}
                              active={active && view === "graph"}
                              onShowDoc={showDossier}
                              onChain={(anchor) => { setChainAnchor(anchor); setView("chain"); }} />
                </div>
                <div style={{ display: view === "chain" ? "contents" : "none" }}>
                  <ChainView stances={stances} anchor={chainAnchor}
                             setAnchor={setChainAnchor} notify={notify} />
                </div>
                <div style={{ display: view === "timeline" ? "contents" : "none" }}>
                  <TimelineView rows={null} docs={docs} notify={notify} />
                </div>
                <div style={{ display: view === "compare" ? "contents" : "none" }}>
                  <ComparePanel stances={stances} docs={docs}
                                compareList={compareList} notify={notify}
                                onShowDoc={showDossier} />
                </div>
                <div style={{ display: view === "archive" ? "contents" : "none" }}>
                  <ArchiveView active={active && view === "archive"}
                               notify={notify} />
                </div>
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
              {dossier.summary
                ? <div className="dossier-summary">{String(dossier.summary)}</div>
                : <div className="dossier-summary">
                    <span className="badge warn" title="右键文档选「补生成摘要」">
                      无摘要 · 离线/无模型时生成</span>
                  </div>}
              <div className="dossier-actions">
                <button className="link" onClick={() => setReaderDoc(dossier.doc_id)}>打开原件</button>
                <button className="link" onClick={() => respondWith(undefined, dossier.stance)}>作为回应立场</button>
                <button className="link" onClick={() =>
                  addBasket("document", dossier.doc_id,
                            dossier.summary || dossier.title || dossier.doc_id,
                            dossier.title || dossier.doc_id)}>加入素材组</button>
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
            { key: "read", label: "打开原件（阅读器）" },
            { key: "reassign", label: "修改分类",
              submenu: stances.map((s) => ({ key: s.name, label: s.label })) },
            { key: "as-source", label: "作为回应立场" },
            { key: "basket", label: "加入素材组",
              submenu: groups.map((g) => ({ key: String(g.id), label: g.name })) },
            { key: "compare", label: "加入对比" },
            { key: "chain", label: "查看逻辑链" },
            { key: "resummarize", label: "补生成摘要" },
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

      {/* 0.1.4 批 6：统一阅读器（查看与入库分家） */}
      {readerDoc && <ReaderModal docId={readerDoc} onClose={() => setReaderDoc(null)} />}
    </div>
  );
}
