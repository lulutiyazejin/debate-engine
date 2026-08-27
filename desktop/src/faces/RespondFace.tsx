// 回应面（PLAN-0.1.2 项目16-20）：左=素材篮+回应历史 · 中=输入→意图→输出 ·
// 右=页边注（引用/谬误）。意图一级化：反驳/批判/评价/分析/综合报告。
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { askConfirm, askInput } from "../components/AppDialog";
import OverlayMenu, { type MenuItem } from "../components/OverlayMenu";
import type { StanceOpt } from "../App";
import ComparePanel from "../panels/ComparePanel";
import RebutPanel from "../panels/RebutPanel";
import DebatePanel from "../panels/DebatePanel";
import { ReportPanel } from "../panels/ReportPanel";
import SegmentedSlider from "../components/SegmentedSlider";

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
  { key: "debate", label: "对辩" },     // 0.1.8 N1：双立场自动对辩
  { key: "report", label: "综合报告" },
] as const;

// 历史记录旧意图词汇保留显示映射（批 3：三意图已并入回答风格表）
const INTENT_NAME: Record<string, string> = {
  rebut: "反驳", critique: "批判", evaluate: "评价",
  analyze: "分析", report: "报告", answer: "回答", debate: "对辩",
};

export default function RespondFace({
  stances, notify, prefill, basketVersion, basketChanged, onSaved,
}: Props) {
  const [intent, setIntent] = useState("answer");
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);          // 批 4：素材组
  const [groupFold, setGroupFold] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);            // 0.1.8 R4: 收边态
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histSel, setHistSel] = useState<HistoryItem | null>(null);
  const [side, setSide] = useState<{ title: string; body: ReactNode } | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [localPrefill, setLocalPrefill] = useState(prefill);
  // 0.1.8 R1：素材右键菜单（行内 × 已删，防误触）
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: BasketItem } | null>(null);
  // 0.1.9 R2：素材组组头右键菜单（整组注入 / 改名 / 删除组）
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: Group } | null>(null);

  useEffect(() => { setLocalPrefill(prefill); }, [prefill]);

  // 0.1.8 R4: persist leftOpen
  useEffect(() => {
    const stored = localStorage.getItem("respondLeftOpen");
    if (stored) setLeftOpen(stored === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem("respondLeftOpen", String(leftOpen));
  }, [leftOpen]);

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
    if (!(await askConfirm({ title: "移出素材？", body: "确认移出这条素材吗？" }))) return;
    await api.del(`/api/basket/${id}`).catch((e) => notify(`删除失败：${e}`));
    loadBasket();
    basketChanged();
  };

  // ---------- 素材组操作（批 4） ----------
  const toggleSelect = (id: number, on: boolean) => {
    setSelected((prev) => {
      if (!on) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const injectGroup = (items: BasketItem[]) => {
    setSelected((prev) => {
      const merged = [...prev];
      for (const it of items) {
        if (!merged.includes(it.id)) merged.push(it.id);
      }
      return merged;
    });
  };

  const addGroup = async () => {
    const name = await askInput({ title: "新建素材组", placeholder: "组名称" });
    if (!name?.trim()) return;
    try { await api.post("/api/groups", { name: name.trim() }); loadBasket(); }
    catch (e) { notify(`建组失败：${e}`); }
  };
  // 0.1.9 R2：改名（组头右键菜单入口，公共组不可改名）
  const renameGroup = async (g: Group) => {
    const name = await askInput({ title: `重命名组「${g.name}」`,
      placeholder: "新组名", initial: g.name });
    if (!name?.trim() || name.trim() === g.name) return;
    try { await api.patch(`/api/groups/${g.id}`, { name: name.trim() }); loadBasket(); }
    catch (e) { notify(`改名失败：${e}`); }
  };


  const deleteGroup = async (g: Group) => {
    if (!(await askConfirm({ title: `删除组「${g.name}」？`,
        body: "组内素材不会删除，将并入公共素材组。", danger: true }))) return;
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
        { path: `inbox/${name}`, content: md });   // 0.1.8 修复：后端字段为 path/content，旧传参 422
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

  // 0.1.8 N4：导出 Argdown（Tauri save 对话框选路径 → save-text 落盘 UTF-8）
  const exportArgdown = async (h: HistoryItem) => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `回应-${h.id}.argdown`,
        filters: [{ name: "Argdown", extensions: ["argdown"] }] });
      if (!path) return;
      // 论证结构转 Argdown：首段=主张，后续段落=论据（+ 支持语法）
      const paras = h.output_text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      const claim = (paras[0] || h.input_text).replace(/\s+/g, " ").slice(0, 200);
      let md = `[主张]: ${claim}\n`;
      paras.slice(1).forEach((p, i) => {
        md += `  + <论据${i + 1}>: ${p.replace(/\s+/g, " ")}\n`;
      });
      await api.post("/api/kb/save-text", { path, content: md });
      notify("已导出 Argdown");
    } catch (e) { notify(`导出失败: ${e}`); }
  };

  return (
    <div className="resp-face">
      {/* 左栏：素材组（批 4）+ 历史 */}
      <aside className="resp-left" style={{ width: leftOpen ? undefined : '28px', transition: 'width 0.12s' }}>
        {leftOpen && (
          <div className="col-head">
            素材组 <span className="muted small">已选 {selected.length} · 勾选注入生成</span>
          </div>
        )}
        {!leftOpen && (
          <div className="col-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '32px', gap: 4 }}>
            <span className="badge warn" style={{ minWidth: 20 }}>{selected.length}</span>
          </div>
        )}
        <button title={leftOpen ? "收起" : "展开"} onClick={() => setLeftOpen(!leftOpen)}
                style={{ position: 'absolute', right: -28, top: 8, width: 28, height: 28,
                         background: 'var(--bg-2)', border: '1px solid var(--tx-3)', borderRadius: 4,
                         cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {leftOpen ? "▸" : "▾"}
        </button>
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
                <div className="tree-stance"
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation();
                    setGroupMenu({ x: e.clientX, y: e.clientY, group: g }); }}
                  onClick={() =>
                  setGroupFold((prev) => prev.includes(g.id)
                    ? prev.filter((x) => x !== g.id) : [...prev, g.id])}>
                  <svg width="10" height="10" viewBox="0 0 10 10"
                       style={{ transform: folded ? "rotate(-90deg)" : "none" }}>
                    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor"
                          strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  {g.name} <span className="muted">({items.length})</span>
                  {selected.filter(id => items.some(i => i.id === id)).length > 0 && (
                    <span className="muted small">已选 {selected.filter(id => items.some(i => i.id === id)).length}</span>
                  )}
                  <span className="spacer" />
                  {items.length > 0 && (
                    <button className="link" title="整组注入"
                            onClick={(e) => { e.stopPropagation(); injectGroup(items); }}>全选</button>
                  )}
                </div>
                {!folded && items.map((b) => (
                  <label key={b.id} className={"basket-item" + (b.used ? " used" : "")}
                         onContextMenu={(e) => { e.preventDefault(); setItemMenu({ x: e.clientX, y: e.clientY, item: b }); }}>
                    <input type="checkbox" checked={selected.includes(b.id)}
                           onChange={(e) => toggleSelect(b.id, e.target.checked)} />
                    <span className="basket-text" title={b.excerpt}>
                      {b.excerpt.slice(0, 60)}
                      <i className="muted"> · {b.source || b.item_type}{b.used ? " · 已使用" : ""}</i>
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
          {/* 0.1.5 K2：+ 号改自绘 plus 图标，与组头 chevron 同列宽 */}
          <button className="add-group" onClick={addGroup}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M5 1.5v7M1.5 5h7" />
            </svg>
            新建素材组
          </button>
        </div>

        <div className="col-head">
          生成历史 <span className="muted small">{history.length}</span>
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
        {/* 0.1.5 J7：回应三段改滑移分段器 */}
        <div className="seg-row intent-seg">
          <SegmentedSlider value={intent}
            onChange={(k) => { setIntent(k); setHistSel(null); }}
            options={INTENTS.map((it) => ({ key: it.key, label: it.label }))} />
          <div className="spacer" />
          {/* 0.1.6 项 6：收起态才显弹出钮「<」；收缩钮入页边注内部 */}
          {!sideOpen && (
            <button className="fold" onClick={() => setSideOpen(true)}
                    title="展开页边注">{"<"}</button>)}
        </div>

        {histSel ? (
          <div className="hist-detail">
            <div className="hist-detail-bar">
              <span className="muted small">
                {INTENT_NAME[histSel.intent] || histSel.intent} · {histSel.created_at} · {histSel.provider || "—"}
              </span>
              <button className="link" onClick={() => saveToKb(histSel)}>存入知识库</button>
              {/* 0.1.8 N4：回应结果卡操作行——导出 Argdown */}
              <button className="link" onClick={() => exportArgdown(histSel)}>导出 Argdown</button>
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
            {/* 0.1.8 N1：双立场自动对辩 */}
            {intent === "debate" && (
              <DebatePanel stances={stances} notify={notify} onSaved={loadHistory} />
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
          <div className="col-head side-head">{side?.title || "页边注"}
            <button className="fold" onClick={() => setSideOpen(false)}
                    title="收起页边注">{">"}</button>
          </div>
          <div className="side-body">
            {side?.body || <div className="muted pad small">生成后，引用来源与质量度量会作为页边注显示在这里。</div>}
          </div>
        </aside>
      )}
      {/* 0.1.8 R1：素材右键菜单 */}
      {itemMenu && (
        <OverlayMenu x={itemMenu.x} y={itemMenu.y} onClose={() => setItemMenu(null)}
          items={[
            { key: "copy", label: "复制摘录", onClick: () => {
                navigator.clipboard.writeText(itemMenu.item.excerpt).catch(() => {});
                setItemMenu(null); notify("已复制"); } },
            { key: "-" , label: "" },
            { key: "remove", label: "移除出组", danger: true, onClick: () => {
                const id = itemMenu.item.id; setItemMenu(null); removeBasket(id); } },
          ]} />
      )}
      {/* 0.1.9 R2：素材组组头右键菜单（公共组仅「整组注入」） */}
      {groupMenu && (() => {
        const g = groupMenu.group;
        const items = basket.filter((b) => b.group_id === g.id);
        const menuItems: MenuItem[] = [
          { key: "inject", label: "整组注入",
            onClick: () => { injectGroup(items); setGroupMenu(null); } },
        ];
        if (!g.pinned) {
          menuItems.push(
            { key: "rename", label: "改名…",
              onClick: () => { const gg = g; setGroupMenu(null); renameGroup(gg); } },
            { key: "-", label: "" },
            { key: "delete", label: "删除组…", danger: true,
              onClick: () => { const gg = g; setGroupMenu(null); deleteGroup(gg); } },
          );
        }
        return <OverlayMenu x={groupMenu.x} y={groupMenu.y}
                 onClose={() => setGroupMenu(null)} items={menuItems} />;
      })()}
    </div>
  );
}
