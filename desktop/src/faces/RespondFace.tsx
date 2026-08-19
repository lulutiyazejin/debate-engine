// 回应面（PLAN-0.1.2 项目16-20）：左=素材篮+回应历史 · 中=输入→意图→输出 ·
// 右=页边注（引用/谬误）。意图一级化：反驳/批判/评价/分析/综合报告。
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { StanceOpt } from "../App";
import ComparePanel from "../panels/ComparePanel";
import RebutPanel from "../panels/RebutPanel";
import { ReportPanel } from "../panels/ReportPanel";

interface BasketItem { id: number; item_type: string; ref_id: string;
                       excerpt: string; source: string; used: number;
                       group_id?: number }
interface Group { id: number; name: string; pinned: number; count: number }
interface HistoryItem { id: number; intent: string; stance: string;
                        input_text: string; output_text: string;
                        provider: string; starred: number; created_at: string }

interface Props {
  stances: StanceOpt[];
  active: boolean;
  notify: (msg: string) => void;
  prefill: { stance?: string; argument?: string; style?: string };
  basketVersion: number;
  basketChanged: () => void;
  onSaved: () => void;
}

const INTENTS = [
  { key: "answer", label: "回答" },
  { key: "analyze", label: "分析" },
  { key: "report", label: "综合报告" },
] as const;

// 历史记录旧意图词汇保留显示映射（批 3：三意图已并入回答风格表）
const INTENT_NAME: Record<string, string> = {
  rebut: "反驳", critique: "批判", evaluate: "评价",
  analyze: "分析", report: "报告", answer: "回答",
};

export default function RespondFace({
  stances, notify, prefill, basketVersion, basketChanged, onSaved,
}: Props) {
  const [intent, setIntent] = useState("answer");
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);          // 批 4：素材组
  const [groupFold, setGroupFold] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histSel, setHistSel] = useState<HistoryItem | null>(null);
  const [side, setSide] = useState<{ title: string; body: ReactNode } | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [localPrefill, setLocalPrefill] = useState(prefill);

  useEffect(() => { setLocalPrefill(prefill); }, [prefill]);

  const loadBasket = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([
        api.get<{ items: BasketItem[] }>("/api/basket"),
        api.get<{ groups: Group[] }>("/api/groups"),
      ]);
      setBasket(r.items);
      setGroups(g.groups);
      setSelected((prev) => prev.filter((id) => r.items.some((i) => i.id === id)));
    } catch { /* 引擎启动前静默 */ }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api.get<{ items: HistoryItem[] }>("/api/responses");
      setHistory(r.items);
    } catch { /* 同上 */ }
  }, []);

  useEffect(() => { loadBasket(); }, [loadBasket, basketVersion]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const removeBasket = async (id: number) => {
    await api.del(`/api/basket/${id}`).catch((e) => notify(`删除失败: ${e}`));
    loadBasket();
    basketChanged();
  };

  // ---------- 素材组操作（批 4） ----------
  const toggleSelect = (id: number, on: boolean) => {
    setSelected((prev) => {
      if (!on) return prev.filter((x) => x !== id);
      if (prev.length >= 20) {
        notify("单次注入预算已满（20 条，prompt 物理限制）");
        return prev;
      }
      return [...prev, id];
    });
  };

  const injectGroup = (items: BasketItem[]) => {
    setSelected((prev) => {
      const merged = [...prev];
      for (const it of items) {
        if (merged.length >= 20) { notify("注入预算已满（20 条），其余未勾选"); break; }
        if (!merged.includes(it.id)) merged.push(it.id);
      }
      return merged;
    });
  };

  const addGroup = async () => {
    const name = window.prompt("新素材组名称：");
    if (!name?.trim()) return;
    try { await api.post("/api/groups", { name: name.trim() }); loadBasket(); }
    catch (e) { notify(`建组失败: ${e}`); }
  };

  const renameGroup = async (g: Group) => {
    const name = window.prompt("组改名：", g.name);
    if (!name?.trim() || name.trim() === g.name) return;
    try { await api.patch(`/api/groups/${g.id}`, { name: name.trim() }); loadBasket(); }
    catch (e) { notify(`改名失败: ${e}`); }
  };

  const deleteGroup = async (g: Group) => {
    if (!window.confirm(`删除组「${g.name}」？组内素材不会删除，将并入公共素材组。`)) return;
    try {
      const r = await api.del<{ moved: number }>(`/api/groups/${g.id}`);
      notify(`组已删，${r.moved} 条素材并入公共素材组`);
      loadBasket();
    } catch (e) { notify(`删组失败: ${e}`); }
  };

  const toggleStar = async (h: HistoryItem) => {
    await api.patch(`/api/responses/${h.id}/star`, { starred: !h.starred })
      .catch((e) => notify(`收藏失败: ${e}`));
    loadHistory();
  };

  const delHistory = async (h: HistoryItem) => {
    await api.del(`/api/responses/${h.id}`).catch((e) => notify(`删除失败: ${e}`));
    if (histSel?.id === h.id) setHistSel(null);
    loadHistory();
  };

  // 项目20：把历史回应存入知识库（save-text → import → confirm 三步）
  const saveToKb = async (h: HistoryItem) => {
    try {
      const name = `自产回应-${INTENT_NAME[h.intent] || h.intent}-${h.id}.md`;
      const md = `# 自产回应（${INTENT_NAME[h.intent] || h.intent}）\n\n` +
        `> 原始输入：${h.input_text}\n> 生成立场：${h.stance || "—"} · ` +
        `模型：${h.provider || "—"} · ${h.created_at}\n\n${h.output_text}`;
      const saved = await api.post<{ path: string }>("/api/kb/save-text",
        { filename: `inbox/${name}`, text: md });
      const pv = await api.post<{ doc_id: string }>("/api/import",
        { source: saved.path });
      await api.post("/api/import/confirm",
        { doc_id: pv.doc_id, stance: h.stance || stances[0]?.name || "empirical" });
      notify("已存入知识库（来源标注：自产回应）");
      onSaved();
    } catch (e) {
      notify(`存入失败: ${e}`);
    }
  };

  return (
    <div className="resp-face">
      {/* 左栏：素材组（批 4）+ 历史 */}
      <aside className="resp-left">
        <div className="col-head">
          素材组 <span className="muted small">已选 {selected.length}/20 · 勾选注入生成</span>
        </div>
        <div className="basket-list">
          {basket.length === 0 && groups.length <= 1 && (
            <div className="empty-state small">
              <p>素材组是空的</p>
              <p className="muted small">在知识库面的检索结果、图谱节点或文档右键菜单里「加入素材组」。</p>
            </div>
          )}
          {groups.map((g) => {
            const items = basket.filter((b) => b.group_id === g.id);
            const folded = groupFold.includes(g.id);
            return (
              <div key={g.id} className="mat-group">
                <div className="tree-stance" onClick={() =>
                  setGroupFold((prev) => prev.includes(g.id)
                    ? prev.filter((x) => x !== g.id) : [...prev, g.id])}>
                  <svg width="10" height="10" viewBox="0 0 10 10"
                       style={{ transform: folded ? "rotate(-90deg)" : "none" }}>
                    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor"
                          strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  {g.name} <span className="muted">({items.length})</span>
                  <span className="spacer" />
                  {items.length > 0 && (
                    <button className="link" title="整组注入"
                            onClick={(e) => { e.stopPropagation(); injectGroup(items); }}>全选</button>
                  )}
                  {!g.pinned && (
                    <>
                      <button className="link" title="改名"
                              onClick={(e) => { e.stopPropagation(); renameGroup(g); }}>改</button>
                      <button className="link" title="删组（材料并入公共素材组）"
                              onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}>×</button>
                    </>
                  )}
                </div>
                {!folded && items.map((b) => (
                  <label key={b.id} className={"basket-item" + (b.used ? " used" : "")}>
                    <input type="checkbox" checked={selected.includes(b.id)}
                           onChange={(e) => toggleSelect(b.id, e.target.checked)} />
                    <span className="basket-text" title={b.excerpt}>
                      {b.excerpt.slice(0, 60)}
                      <i className="muted"> · {b.source || b.item_type}{b.used ? " · 已使用" : ""}</i>
                    </span>
                    <button className="link" onClick={(e) => { e.preventDefault(); removeBasket(b.id); }}>×</button>
                  </label>
                ))}
              </div>
            );
          })}
          <button className="link pad-h" onClick={addGroup}>+ 新建素材组</button>
        </div>

        <div className="col-head">
          回应历史 <span className="muted small">{history.length}</span>
        </div>
        <div className="history-list">
          {history.length === 0 && <div className="muted pad small">生成过的回应会记录在这里</div>}
          {history.map((h) => (
            <div key={h.id}
                 className={"history-item" + (histSel?.id === h.id ? " sel" : "")}
                 onClick={() => { setHistSel(h); }}>
              <span className="hist-intent">{INTENT_NAME[h.intent] || h.intent}</span>
              <span className="hist-text">{h.input_text.slice(0, 42)}</span>
              <span className="hist-ops">
                <button className="link" title={h.starred ? "取消收藏" : "收藏置顶"}
                        onClick={(e) => { e.stopPropagation(); toggleStar(h); }}>
                  {h.starred ? "★" : "☆"}</button>
                <button className="link" title="删除"
                        onClick={(e) => { e.stopPropagation(); delHistory(h); }}>×</button>
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* 中央：意图 → 生成 */}
      <main className="resp-center">
        <div className="seg intent-seg">
          {INTENTS.map((it) => (
            <button key={it.key} className={intent === it.key ? "seg-on" : ""}
                    onClick={() => { setIntent(it.key); setHistSel(null); }}>
              {it.label}</button>
          ))}
          <div className="spacer" />
          <button className="fold" onClick={() => setSideOpen(!sideOpen)}
                  title={sideOpen ? "收起页边注" : "展开页边注"}>
            {sideOpen ? "⟩" : "⟨"}</button>
        </div>

        {histSel ? (
          <div className="hist-detail">
            <div className="hist-detail-bar">
              <span className="muted small">
                {INTENT_NAME[histSel.intent] || histSel.intent} · {histSel.created_at} · {histSel.provider || "—"}
              </span>
              <button className="link" onClick={() => saveToKb(histSel)}>存入知识库</button>
              <button className="link" onClick={() => {
                // 批 3：旧意图回填→回答 tab + 对应风格；analyze/report 回自己的 tab
                const styleMap: Record<string, string> = {
                  rebut: "rebuttal", critique: "critique", evaluate: "evaluate" };
                setLocalPrefill({ argument: histSel.input_text, stance: histSel.stance,
                                  style: styleMap[histSel.intent] });
                setIntent(histSel.intent === "analyze" || histSel.intent === "report"
                  ? histSel.intent : "answer");
                setHistSel(null);
              }}>回填重新生成</button>
              <button className="link" onClick={() => setHistSel(null)}>返回 ×</button>
            </div>
            <div className="hist-input muted">输入：{histSel.input_text}</div>
            <div className="output"><pre className="md-preview">{histSel.output_text}</pre></div>
          </div>
        ) : (
          <>
            {intent === "answer" && (
              <RebutPanel stances={stances} prefill={localPrefill}
                          setSide={setSide} setRightOpen={setSideOpen}
                          notify={notify}
                          materialIds={selected}
                          onDone={() => { loadHistory(); loadBasket(); basketChanged(); }} />
            )}
            {intent === "analyze" && (
              <div className="analyze-wrap">
                <p className="muted small pad-h">粘贴两段文本做论点级对比分析（库内文档对比在知识库面「对比」投影）。</p>
                <ComparePanel stances={stances} docs={[]} compareList={[]}
                              notify={notify} initialMode="texts" />
              </div>
            )}
            {intent === "report" && (
              <ReportPanel stances={stances} notify={notify} />
            )}
          </>
        )}
      </main>

      {/* 右栏：页边注（引用/谬误详情） */}
      {sideOpen && (
        <aside className="resp-right marginalia">
          <div className="col-head">{side?.title || "页边注"}</div>
          <div className="side-body">
            {side?.body || <div className="muted pad small">生成后，引用来源与质量度量会作为页边注显示在这里。</div>}
          </div>
        </aside>
      )}
    </div>
  );
}
