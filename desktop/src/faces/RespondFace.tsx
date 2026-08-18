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
                       excerpt: string; source: string; used: number }
interface HistoryItem { id: number; intent: string; stance: string;
                        input_text: string; output_text: string;
                        provider: string; starred: number; created_at: string }

interface Props {
  stances: StanceOpt[];
  active: boolean;
  notify: (msg: string) => void;
  prefill: { stance?: string; argument?: string };
  basketVersion: number;
  basketChanged: () => void;
  onSaved: () => void;
}

const INTENTS = [
  { key: "rebut", label: "反驳" },
  { key: "critique", label: "批判" },
  { key: "evaluate", label: "评价" },
  { key: "analyze", label: "分析" },
  { key: "report", label: "综合报告" },
] as const;

const INTENT_NAME: Record<string, string> = {
  rebut: "反驳", critique: "批判", evaluate: "评价",
  analyze: "分析", report: "报告",
};

export default function RespondFace({
  stances, notify, prefill, basketVersion, basketChanged, onSaved,
}: Props) {
  const [intent, setIntent] = useState("rebut");
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histSel, setHistSel] = useState<HistoryItem | null>(null);
  const [side, setSide] = useState<{ title: string; body: ReactNode } | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [localPrefill, setLocalPrefill] = useState(prefill);

  useEffect(() => { setLocalPrefill(prefill); }, [prefill]);

  const loadBasket = useCallback(async () => {
    try {
      const r = await api.get<{ items: BasketItem[] }>("/api/basket");
      setBasket(r.items);
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
      {/* 左栏：素材篮 + 历史 */}
      <aside className="resp-left">
        <div className="col-head">
          素材篮 <span className="muted small">{basket.length}/20 · 勾选注入生成</span>
        </div>
        <div className="basket-list">
          {basket.length === 0 && (
            <div className="empty-state small">
              <p>素材篮是空的</p>
              <p className="muted small">在知识库面的检索结果、图谱节点或文档右键菜单里「加入素材篮」。</p>
            </div>
          )}
          {basket.map((b) => (
            <label key={b.id} className={"basket-item" + (b.used ? " used" : "")}>
              <input type="checkbox" checked={selected.includes(b.id)}
                     onChange={(e) => setSelected((prev) =>
                       e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id))} />
              <span className="basket-text" title={b.excerpt}>
                {b.excerpt.slice(0, 60)}
                <i className="muted"> · {b.source || b.item_type}{b.used ? " · 已使用" : ""}</i>
              </span>
              <button className="link" onClick={(e) => { e.preventDefault(); removeBasket(b.id); }}>×</button>
            </label>
          ))}
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
                setLocalPrefill({ argument: histSel.input_text, stance: histSel.stance });
                setIntent(histSel.intent === "analyze" || histSel.intent === "report"
                  ? "rebut" : histSel.intent);
                setHistSel(null);
              }}>回填重新生成</button>
              <button className="link" onClick={() => setHistSel(null)}>返回 ×</button>
            </div>
            <div className="hist-input muted">输入：{histSel.input_text}</div>
            <div className="output"><pre className="md-preview">{histSel.output_text}</pre></div>
          </div>
        ) : (
          <>
            {(intent === "rebut" || intent === "critique" || intent === "evaluate") && (
              <RebutPanel stances={stances} prefill={localPrefill}
                          setSide={setSide} setRightOpen={setSideOpen}
                          notify={notify} intent={intent}
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
