// 逻辑链视图（PLAN-0.1.2 项目14）：锚点 → 沿关系边提取论证主线，年代升序横向铺开。
// 图谱回答「都有什么关系」；逻辑链回答「论证主线怎么一步步走过来」。
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StanceOpt } from "../App";

interface CNode { id: string; claim: string; thinker?: string; doc_id: string;
                  doc_title?: string; stance?: string; year?: number }
interface CLink { source: string; target: string; relation: string }

const REL_LABEL: Record<string, string> = {
  support: "支持", attack: "攻击", refine: "细化",
  evolve: "演进", analogy: "类比", oppose: "同题对立",
};

interface Props {
  stances: StanceOpt[];
  anchor: string;
  setAnchor: (a: string) => void;
  notify: (msg: string) => void;
}

export default function ChainView({ stances, anchor, setAnchor, notify }: Props) {
  const [stance, setStance] = useState("");
  const [nodes, setNodes] = useState<CNode[]>([]);
  const [links, setLinks] = useState<CLink[]>([]);
  const [hint, setHint] = useState("");
  const [running, setRunning] = useState(false);

  const run = useCallback(async (a?: string) => {
    const term = (a ?? anchor).trim();
    if (term.length < 2) return;
    setRunning(true);
    try {
      const r = await api.get<{ nodes: CNode[]; links: CLink[]; hint?: string }>(
        `/api/analysis/chain?anchor=${encodeURIComponent(term)}` +
        (stance ? `&stance=${stance}` : ""));
      setNodes(r.nodes);
      setLinks(r.links);
      setHint(r.hint || "");
    } catch (e) {
      notify(`逻辑链提取失败: ${e}`);
    } finally {
      setRunning(false);
    }
  }, [anchor, stance, notify]);

  // 外部入口（图谱右键/检索结果）带锚点进来时自动执行
  useEffect(() => {
    if (anchor.trim().length >= 2) run(anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // 相邻节点间的关系（无直接边 = 弱链「先后」）
  const relKey = (a: string, b: string): string | undefined =>
    links.find((x) =>
      (x.source === a && x.target === b) || (x.source === b && x.target === a))?.relation;

  return (
    <div className="chain-view">
      <div className="chain-bar">
        <input value={anchor} placeholder="输入锚点：一个论题、主张或思想家（Enter 提取主线）"
               onChange={(e) => setAnchor(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && run()} />
        <select value={stance} onChange={(e) => setStance(e.target.value)}>
          <option value="">全部立场</option>
          {stances.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
        </select>
        <button className="primary" disabled={running} onClick={() => run()}>
          {running ? "提取中…" : "提取主线"}
        </button>
      </div>

      {hint && (
        <div className="empty-state">
          <p>{hint}</p>
          <p className="muted small">提示：到「图谱」投影点「生成/更新关系边」，或在设置中配置模型 Key。</p>
        </div>
      )}

      {!hint && nodes.length === 0 && (
        <div className="empty-state">
          <p>输入锚点提取论证主线</p>
          <button className="link" onClick={() => { setAnchor("市场经济"); run("市场经济"); }}>
            试试：「市场经济」→</button>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="chain-flow">
          <div className="chain-col">
            <div className="chain-hint">top → bottom = time</div>
            {nodes.map((n, i) => (
              <div key={n.id}>
                {i > 0 && (
                  <div className="chain-link">
                    <span className="cl-line" />
                    <span className={"rel-chip rel-" +
                      (relKey(nodes[i - 1].id, n.id) || "none")}>
                      {REL_LABEL[relKey(nodes[i - 1].id, n.id) || ""] || "先后"}
                    </span>
                    <span className="cl-line" />
                    <span className="cl-head">▾</span>
                  </div>
                )}
                <div className="chain-node" style={{ animationDelay: `${i * 40}ms` }}
                     title="点击以此主张为锚点继续追" 
                     onClick={() => setAnchor(n.claim)}>
                  <div className="cn-src">{n.year ?? "年代不详"} · {n.thinker || "—"}</div>
                  <div className="cn-claim">{n.claim}</div>
                  <div className="cn-src">{n.doc_title || n.doc_id}</div>
                </div>
              </div>
            ))}
            <div className="chain-legend">
              {Object.entries(REL_LABEL).map(([k, v]) => (
                <span key={k} className={"rel-chip rel-" + k}>{v}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
