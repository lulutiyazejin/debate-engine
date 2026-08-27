// 知识库面（PLAN-0.1.2 项目10/11/12/13/15）：
// 顶部检索区（段落/论点/脉络三视角，搜索+溯源合并）；
// 中画布五投影（馆藏/图谱/逻辑链/脉络/对比）；右档案卡 + 右键菜单。
// 0.1.9 L1：馆藏改文件夹两级导航（FolderRoot），删除左树 DocTree 与 M1 过滤死码。
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { stanceLabel as _stanceLabel } from "../lib/stance";
import { askConfirm } from "../components/AppDialog";
import type { DocRow, StanceOpt } from "../App";
import Combobox, { Hl } from "../components/Combobox";
import ReaderModal from "../components/ReaderModal";
import SegmentedSlider from "../components/SegmentedSlider";
import ComparePanel from "../panels/ComparePanel";
import VizPanel from "../panels/VizPanel";
import ImportPanel from "../panels/ImportPanel";
import ChainView from "../views/ChainView";
import TimelineView from "../views/TimelineView";
import ArchiveView from "../views/ArchiveView";
import ReextractButton from "../components/ReextractButton";
import OverlayMenu from "../components/OverlayMenu";
import type { MenuItem } from "../components/OverlayMenu";
import type { LibView, LibSort } from "../components/DocExplorer";
import MetadataDialog from "../components/MetadataDialog";
import ReviewPanel from "../components/ReviewPanel";
import MergeDialog from "../components/MergeDialog";
import FolderRoot from "../components/FolderRoot";

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
  const [coordsVersion, setCoordsVersion] = useState(0);   // 0.1.7 项 3：重提取版本计数器（VizPanel coordsVersion）
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
  // 0.1.8 M1：三视图 + 排序（localStorage 持久）
  const [libView, setLibView] = useState<LibView>(
    () => (localStorage.getItem("lib.view") as LibView) || "details");
  const [libSort, setLibSort] = useState<LibSort>(
    () => (localStorage.getItem("lib.sort") as LibSort) || "import");
  const [sortDesc, setSortDesc] = useState(
    () => localStorage.getItem("lib.sortDesc") !== "0");
  useEffect(() => {
    localStorage.setItem("lib.view", libView);
    localStorage.setItem("lib.sort", libSort);
    localStorage.setItem("lib.sortDesc", sortDesc ? "1" : "0");
  }, [libView, libSort, sortDesc]);
  // 0.1.8 M3/M2/M6/V7：元数据弹窗 / 待审面板 / 多选合并 / 局部图谱
  const [metaDoc, setMetaDoc] = useState<DocRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [focusDocId, setFocusDocId] = useState<string | null>(null);
  // 0.1.9 L4：原始数据区折叠展开态（默认折叠， localStorage 记忆）
  const [rawOpen, setRawOpen] = useState(() => localStorage.getItem("lib.rawOpen") === "1");
  // 0.1.9 L3：馆藏文件夹面包屑（受控）+ 过滤词 + 待提取坐标角标计数
  const [crumbStance, setCrumbStance] = useState<string | null>(null);
  const [collFilter, setCollFilter] = useState("");
  const [pendingCoords, setPendingCoords] = useState(0);
  const pendingCount = docs.filter((d) => d.review_status === "pending").length;
  // 0.1.8 M2：待审文档不参与脉络
  const approvedDocs = docs.filter((d) => d.review_status !== "pending");

  const stanceLabel = useCallback((key: string) => _stanceLabel(key, stances), [stances]);

  // 0.1.9 L3：待提取坐标数（全 0 / 缺失），供工具条黄色角标
  const refreshPendingCoords = useCallback(async () => {
    try {
      const r = await api.get<{ count: number }>("/api/analysis/coords/pending_count");
      setPendingCoords(r.count);
    } catch { /* 引擎未起时静默 */ }
  }, []);
  useEffect(() => {
    if (active && view === "collection") refreshPendingCoords();
  }, [active, view, docs.length, refreshPendingCoords]);

  // 0.1.9 L1：分组/立场导航逻辑已迁入 FolderRoot 组件

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

  // 0.1.4 项 6：阅读器开关（doc_id）
  const [readerDoc, setReaderDoc] = useState<string | null>(null);

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
  const onMenuAction = useCallback(async (action: string, doc: DocRow) => {
    setMenu(null);
    if (action === "metadata") {
      setMetaDoc(doc);   // 0.1.8 M3：编辑元数据（含立场改分类）
    } else if (action === "as-source") {
      respondWith(undefined, doc.stance);
      notify(`已切到回应面（立场：${stanceLabel(doc.stance || "")}）`);
    } else if (action === "basket") {
      // 0.1.8 G1：子菜单打平 → 默认落公共组
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
    } else if (action === "graph") {
      // 0.1.8 V7：局部图谱入口 → 图谱投影力导向过滤该文档
      setFocusDocId(doc.doc_id);
      setView("graph");
    } else if (action === "approve") {
      // 0.1.8 M2：单篇直接通过审核
      try {
        await api.post(`/api/knowledge/docs/${doc.doc_id}/approve`, {});
        notify("已通过审核，纳入检索与图谱");
        refreshDocs();
      } catch (e) { notify(`审核失败: ${e}`); }
    } else if (action === "merge") {
      setMergeOpen(true);   // 0.1.8 M6：多选合并
    } else if (action === "read") {
      setReaderDoc(doc.doc_id);   // 0.1.4 项 6：统一阅读器
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
      if (!(await askConfirm({ title: `确定删除「${doc.title || doc.doc_id}」？`,
          body: "将级联清除章节、切块、向量；档案库归档默认保留。", danger: true }))) return;
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
        <input className="search-input" value={q} placeholder="检索知识库：一次查询覆盖段落 / 论点 / 脉络三视角（Enter 执行，Esc 清空）"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter") runSearch();
                 if (e.key === "Escape") { setQ(""); setParaHits(null); setUnitHits(null); }
               }} />
        <Combobox width={170} value={fStance} onChange={setFStance}
                  placeholder="全部立场" scopeLabel="立场："
                  options={[{ value: "", label: "全部立场" },
                            ...stances.map((s) => ({ value: s.name, label: s.label }))]} />
        <input className="year-input" value={yearFrom} placeholder="起始年"
               onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, ""))} />
        <input className="year-input" value={yearTo} placeholder="结束年"
               onChange={(e) => setYearTo(e.target.value.replace(/\D/g, ""))} />
        <button className="primary" disabled={searching} onClick={() => runSearch()}>
          {searching ? "检索中…" : "检索"}
        </button>
      </div>

      <div className="lib-body">
        {/* 0.1.9 L2/项目 22：常驻左栏已退役，文档树迁入馆藏主从布局；L2：导入面板迁至左栏 */}
        
        {/* 中区：检索结果 或 画布投影 */}
        <main className="lib-center">
          {hasSearch ? (
            <div className="search-results">
              {/* 0.1.5 J7：检索视图改滑移分段器 */}
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
                        <span className="muted">{r.thinker || "佚名"} · {r.doc_title || r.doc_id} · {r.year ?? "年代不详"}</span>
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
                      <span className="spec-tag">模型推测 · 无库内文献佐证</span>
                      <p>{speculation}</p>
                    </div>
                  )}
                </div>
              )}
              {searchTab === "era" && (
                <TimelineView rows={unitHits ?? []} docs={approvedDocs} stances={stances} notify={notify} />
              )}
            </div>
          ) : (
            <>
              {/* 左栏 + 中区布局（L2）：左栏 = 导入面板 | 中区 = 五视图滑移 */}
              <div className="lib-split-left">
                <ImportPanel stances={stances} notify={notify} onDone={() => { refreshDocs(); setView("collection"); }}
                             active={active && view === "collection"} />
              </div>
              <div className="lib-main-view">
                {/* 0.1.5 J7：馆藏五段改滑移分段器（120ms 固定时长，键盘 ←→ 切换） */}
                <div className="seg-row view-seg">
                  <SegmentedSlider value={view} onChange={setView}
                    options={VIEWS.map((v) => ({ key: v.key, label: v.label }))} />
                </div>
                <div className="lib-canvas">
                  {/* 0.1.9 L1/L2: 文件夹两级导航 + 工具条 */}
                  <div style={{ display: view === "collection" ? "contents" : "none" }}>
                    {/* 0.1.9 L3：工具条两行——行1 面包屑 + 过滤框；行2 操作组 */}
                    <div className="coll-toolbar coll-crumbrow">
                      <div className="coll-crumb">
                        <span className={crumbStance == null ? "" : "link"}
                              onClick={() => { setCrumbStance(null); setMultiSel([]); }}>馆藏</span>
                        {crumbStance != null && (
                          <>
                            <span className="muted" style={{ margin: "0 6px" }}>/</span>
                            <b>{stances.find((s) => s.name === crumbStance)?.label || crumbStance || "未分类"}</b>
                          </>
                        )}
                      </div>
                      <div className="spacer" />
                      <input className="coll-filter" value={collFilter}
                             placeholder={crumbStance == null ? "过滤文件夹…" : "过滤标题 / 作者…"}
                             onChange={(e) => setCollFilter(e.target.value)} />
                      {collFilter && (
                        <button className="link" title="清空过滤"
                                onClick={() => setCollFilter("")}>×</button>
                      )}
                    </div>
                    {/* 中区工具条：统一审核入口 + 重提取 + 三视图钮 + 排序 */}
                    <div className="coll-toolbar">
                      <span className="muted small">
                        {stats.documents ?? docs.length} 篇 · {stats.chunks ?? 0} 块 · {stats.arg_units ?? 0} 论证
                      </span>
                      {pendingCount > 0 && (
                        <button className="link warn" onClick={() => setReviewOpen(true)}>
                          {pendingCount} 篇待审
                        </button>
                      )}
                      <div className="spacer" />
                      {/* 0.1.7 项 3：重提取按钮保留工具行（Q8）；0.1.9 L3：待提取坐标黄色角标 */}
                      <ReextractButton notify={notify} pendingCoords={pendingCoords}
                        onDone={() => { setCoordsVersion((v) => v + 1); refreshPendingCoords(); }} />
                      <SegmentedSlider value={libView}
                        onChange={(k) => setLibView(k as LibView)}
                        options={[{ key: "icons", label: "图标" },
                                  { key: "list", label: "列表" },
                                  { key: "details", label: "详情" }]} />
                      <select className="sort-sel" value={libSort} title="排序方式"
                              onChange={(e) => setLibSort(e.target.value as LibSort)}>
                        <option value="import">按导入时间</option>
                        <option value="title">按标题（拼音）</option>
                        <option value="author">按作者</option>
                        <option value="year">按年份</option>
                      </select>
                      <button className="link" title={sortDesc ? "降序（点击切升序）" : "升序（点击切降序）"}
                              onClick={() => setSortDesc((v) => !v)}>
                        {sortDesc ? "↓" : "↑"}
                      </button>
                    </div>
                    {/* 0.1.9 L1: 文件夹两级导航（根层立场文件夹 → 二层文档列表） */}
                    {docs.length === 0 ? (
                      <div className="empty-state">
                        <p>知识库为空，用左侧导入面板入库第一篇文档</p>
                      </div>
                    ) : (
                      <FolderRoot
                        docs={docs} stances={stances} selectedId={dossier?.doc_id} multiSel={multiSel}
                        view={libView} sort={libSort} sortDesc={sortDesc}
                        crumbStance={crumbStance} filter={collFilter}
                        onCrumbChange={(s) => { setCrumbStance(s); setMultiSel([]); }}
                        onSortChange={(s, d2) => { setLibSort(s); setSortDesc(d2); }}
                        onSelect={(d, e) => {
                          if (e.ctrlKey || e.metaKey) {
                            setMultiSel((prev) => prev.includes(d.doc_id)
                              ? prev.filter((x) => x !== d.doc_id)
                              : [...prev, d.doc_id]);
                          } else {
                            setMultiSel([d.doc_id]);
                            showDossier(d);
                          }
                        }}
                        onOpen={(d) => setReaderDoc(d.doc_id)}
                        onContext={(e, d) => {
                          if (!multiSel.includes(d.doc_id)) setMultiSel([d.doc_id]);
                          setMenu({ x: e.clientX, y: e.clientY, doc: d });
                        }}
                      />
                    )}
                  </div>
                  {/* 五视图子投影 */}
                </div>
                <div style={{ display: view === "graph" ? "contents" : "none" }}>
                  {/* 0.1.5 J5：图谱区升级五种子投影（力导向/3D 立方/散点/雷达/交叉） */}
                  <VizPanel stances={stances} docs={docs} notify={notify}
                              active={active && view === "graph"} onShowDoc={showDossier}
                              onChain={(anchor) => { setChainAnchor(anchor); setView("chain"); }}
                              coordsVersion={coordsVersion} focusDocId={focusDocId} />
                </div>
                <div style={{ display: view === "chain" ? "contents" : "none" }}>
                  <ChainView stances={stances} anchor={chainAnchor}
                             setAnchor={setChainAnchor} notify={notify}
                             onShowDoc={(docId) => {
                               const d = docs.find((x) => x.doc_id === docId);
                               if (d) showDossier(d);
                             }} />
                </div>
                <div style={{ display: view === "timeline" ? "contents" : "none" }}>
                  {/* 0.1.8 M2：待审文档不参与脉络 */}
                  <TimelineView rows={null} docs={approvedDocs} stances={stances} notify={notify} />
                </div>
                <div style={{ display: view === "compare" ? "contents" : "none" }}>
                  <ComparePanel stances={stances} docs={docs}
                                compareList={compareList} notify={notify}
                                onShowDoc={showDossier} />
                </div>
                <div style={{ display: view === "archive" ? "contents" : "none" }}>
                  <ArchiveView active={active && view === "archive"} notify={notify} stances={stances} />
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
              {/* 0.1.8 V6: 结构化四项 + 折叠原始数据 */}
              <div className="meta-row"><span className="muted">标题</span><b>{dossier.title || dossier.doc_id}</b></div>
              {dossier.author && <div className="meta-row"><span className="muted">作者</span>{String(dossier.author)}</div>}
              {(dossier as { year?: number }).year && (
                <div className="meta-row"><span className="muted">年份</span>{(dossier as { year_raw?: string; year?: number }).year_raw || (dossier as { year?: number }).year}</div>
              )}
              <div className="meta-row"><span className="muted">立场</span> {stanceLabel(dossier.stance || "")}</div>
              {/* 0.1.9 R3：档案卡次立场行（与详情列同源，空则 —） */}
              <div className="meta-row"><span className="muted">次立场</span>
                {(() => {
                  const ss = (dossier as { secondary_stances?: string[] }).secondary_stances;
                  return ss && ss.length > 0 ? ss.map((s) => stanceLabel(s)).join(", ") : "—";
                })()}</div>
              {dossier.summary
                ? <div className="dossier-summary mt-2">{String(dossier.summary)}</div>
                : <div className="dossier-summary mt-2">
                    <span className="badge warn" title="右键文档选择补生成摘要">无摘要 · 离线/无模型时生成</span>
                  </div>}
              {/* 坐标展示（简化版：显示非零轴） */}
              {(dossier as any).coordinates && Object.keys((dossier as any).coordinates).some(k => ((dossier as any).coordinates as Record<string,number>)[k] !== 0) && (
                <details className="coords-toggle mt-2">
                  <summary className="link small">查看坐标（{Object.values((dossier as any).coordinates).filter(v => v!==0).length}/22 非零）</summary>
                  <pre className="mt-1 muted">{(JSON.stringify((dossier as any).coordinates, null, 2))}</pre>
                </details>
              )}
              {/* 旁注 */}
              <div className="muted small mt-2">坐标为真值 -5..+5；雷达图显示为 0-10 平移</div>
              <div className="dossier-actions">
                <button className="link" onClick={() => setReaderDoc(dossier.doc_id)}>打开原件</button>
                <button className="link" onClick={() => respondWith(undefined, dossier.stance)}>作为回应立场</button>
                <button className="link" onClick={() =>
                  addBasket("document", dossier.doc_id,
                            dossier.summary || dossier.title || dossier.doc_id,
                            dossier.title || dossier.doc_id)}>加入素材组</button>
                {/* 0.1.8 V7：档案卡局部图谱入口 */}
                <button className="link" onClick={() => {
                  setFocusDocId(dossier.doc_id); setView("graph");
                }}>查看此文档关系图</button>
              </div>
            </div>
            {/* 0.1.9 L4：原始数据区折叠小节头（默认折叠，展开态记忆） */}
            <details className="side-raw" open={rawOpen}
                     onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open;
                       setRawOpen(o); localStorage.setItem("lib.rawOpen", o ? "1" : "0"); }}>
              <summary className="side-raw-head">原始数据（导入原文，供核对）</summary>
              <div className="side-body">{preview}</div>
            </details>
          </aside>
        )}
      </div>

      {/* 右键菜单：0.1.8 G1：OverlayMenu 打平，Portal 到 body 避 transform 裁切 */}
      {menu && (() => {
        const d = menu.doc;
        const items: MenuItem[] = [
          { key: "read", label: "打开原件（阅读器）", onClick: () => onMenuAction("read", d) },
          { key: "metadata", label: "编辑元数据…", onClick: () => onMenuAction("metadata", d) },
          { key: "as-source", label: "作为回应立场", onClick: () => onMenuAction("as-source", d) },
          { key: "basket", label: "加入素材组", onClick: () => onMenuAction("basket", d) },
          { key: "compare", label: "加入对比", onClick: () => onMenuAction("compare", d) },
          { key: "chain", label: "查看逻辑链", onClick: () => onMenuAction("chain", d) },
          { key: "graph", label: "查看此文档关系图", onClick: () => onMenuAction("graph", d) },
          { key: "resummarize", label: "补生成摘要", onClick: () => onMenuAction("resummarize", d) },
        ];
        if (d.review_status === "pending") {
          items.push({ key: "approve", label: "通过审核", onClick: () => onMenuAction("approve", d) });
        }
        if (multiSel.length >= 2 && multiSel.includes(d.doc_id)) {
          items.push({ key: "merge", label: `合并选中的 ${multiSel.length} 篇文档…`,
                       onClick: () => onMenuAction("merge", d) });
        }
        items.push({ key: "-", label: "" });
        items.push({ key: "delete", label: "删除文档", danger: true,
                     onClick: () => onMenuAction("delete", d) });
        return <OverlayMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />;
      })()}

      {/* 0.1.8 M3：元数据编辑弹窗 */}
      {metaDoc && (
        <MetadataDialog doc={metaDoc} stances={stances} notify={notify}
                        onClose={() => setMetaDoc(null)}
                        onSaved={() => { setMetaDoc(null); refreshDocs();
                                         if (dossier?.doc_id === metaDoc.doc_id) setDossier(null); }} />
      )}
      {/* 0.1.8 M2：待审面板 */}
      {reviewOpen && (
        <ReviewPanel docs={docs} stances={stances} notify={notify}
                     onClose={() => setReviewOpen(false)} onChanged={refreshDocs} />
      )}
      {/* 0.1.8 M6：分期文档合并 */}
      {mergeOpen && (
        <MergeDialog docs={docs.filter((x) => multiSel.includes(x.doc_id))} notify={notify}
                     onClose={() => setMergeOpen(false)}
                     onDone={() => { setMergeOpen(false); setMultiSel([]);
                                     setDossier(null); setPreview(null); refreshDocs(); }} />
      )}

      {/* 0.1.4 项 6：统一阅读器（查看与入库分家） */}
      {readerDoc && <ReaderModal docId={readerDoc} onClose={() => setReaderDoc(null)} />}
    </div>
  );
}
