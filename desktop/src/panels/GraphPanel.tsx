// 图谱面板（项目16）：节点=论证单元，边=支持(绿)/攻击(红)/细化(蓝虚)
// 按立场/文档过滤；「生成关系」调对齐引擎写边；节点右键=编辑/删除（人工纠错）
import { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api } from "../api";
import type { DocRow } from "../App";

interface GNode { id: string; claim: string; doc_id: string; doc_title: string; stance?: string; thinker?: string; x?: number; y?: number }
interface GLink { source: string | GNode; target: string | GNode; relation: string }

interface Props {
  stances: { name: string; label: string }[];
  docs: DocRow[];
  notify: (msg: string) => void;
  active: boolean;
}

const EDGE_COLOR: Record<string, string> = {
  support: "#3fb96a", attack: "#e05b5b", refine: "#4f8cff",
};
const STANCE_COLORS = ["#4f8cff", "#e05b5b", "#3fb96a", "#d9a441", "#b07cd8", "#5bc8c8"];

export default function GraphPanel({ stances, docs, notify, active }: Props) {
  const [stance, setStance] = useState("");
  const [docId, setDocId] = useState("");
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const [building, setBuilding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GNode } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const hostRef = useRef<HTMLDivElement>(null);

  const stanceColor = useCallback((s?: string) => {
    const i = stances.findIndex((x) => x.name === s);
    return STANCE_COLORS[(i + STANCE_COLORS.length) % STANCE_COLORS.length];
  }, [stances]);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (stance) q.set("stance", stance);
      if (docId) q.set("doc_id", docId);
      const r = await api.get<{ nodes: GNode[]; links: GLink[] }>(
        `/api/analysis/graph?${q}`);
      setData(r);
    } catch (e) {
      notify(`加载图谱失败: ${e}`);
    }
  }, [stance, docId, notify]);

  useEffect(() => { if (active) load(); }, [active, load]);

  // 容器自适应
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buildRelations = async () => {
    setBuilding(true);
    try {
      const r = await api.post<{ pairs_checked: number; relations_written: number }>(
        "/api/analysis/relations/build", { doc_ids: docId ? [docId] : null });
      notify(`配对检查 ${r.pairs_checked} 组，写入关系边 ${r.relations_written} 条` +
        (r.relations_written === 0 ? "（离线模式不下结论，需配置模型 Key）" : ""));
      load();
    } catch (e) {
      notify(`生成关系失败: ${e}`);
    } finally {
      setBuilding(false);
    }
  };

  const deleteNode = async (node: GNode) => {
    setMenu(null);
    if (!window.confirm(`删除论证单元？\n「${node.claim}」`)) return;
    try {
      await api.del(`/api/analysis/units/${node.id}`);
      notify("已删除");
      load();
    } catch (e) {
      notify(`删除失败: ${e}`);
    }
  };

  const editNode = async (node: GNode) => {
    setMenu(null);
    const claim = window.prompt("修正论点内容：", node.claim);
    if (claim === null || claim.trim() === "" || claim === node.claim) return;
    try {
      await api.patch(`/api/analysis/units/${node.id}`, { claim: claim.trim() });
      notify("已修正");
      load();
    } catch (e) {
      notify(`修正失败: ${e}`);
    }
  };

  return (
    <div className="panel graph" style={{ padding: 0, gap: 0 }}>
      <div className="controls" style={{ padding: "10px 14px" }}>
        <label>立场
          <select value={stance} onChange={(e) => setStance(e.target.value)}>
            <option value="">全部</option>
            {stances.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
          </select>
        </label>
        <label>文档
          <select value={docId} onChange={(e) => setDocId(e.target.value)}>
            <option value="">全部</option>
            {docs.map((d) => <option key={d.doc_id} value={d.doc_id}>{d.title || d.doc_id}</option>)}
          </select>
        </label>
        <button className="primary" onClick={buildRelations} disabled={building}>
          {building ? "对齐判定中…" : "生成/更新关系边"}
        </button>
        <span className="muted small">
          {data.nodes.length} 节点 · {data.links.length} 边 ·
          <span style={{ color: "#3fb96a" }}> ─ 支持</span>
          <span style={{ color: "#e05b5b" }}> ─ 攻击</span>
          <span style={{ color: "#4f8cff" }}> ┄ 细化</span> · 节点右键可纠错
        </span>
      </div>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }}>
        {data.nodes.length === 0
          ? <div className="muted pad">暂无论证单元。导入文档后单元自动提取；点「生成/更新关系边」建立连线。</div>
          : <ForceGraph2D
              graphData={data}
              width={size.w}
              height={size.h}
              backgroundColor="#16181d"
              nodeLabel={(n: GNode) => `${n.claim}\n——${n.thinker || n.doc_title}`}
              nodeColor={(n: GNode) => stanceColor(n.stance)}
              nodeRelSize={5}
              linkColor={(l: GLink) => EDGE_COLOR[l.relation] || "#666"}
              linkWidth={2}
              linkLineDash={(l: GLink) => (l.relation === "refine" ? [4, 3] : null)}
              linkDirectionalArrowLength={5}
              onNodeRightClick={(n: GNode, e: MouseEvent) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node: n });
              }}
              onBackgroundClick={() => setMenu(null)}
            />}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="ctx-item" onClick={() => editNode(menu.node)}>编辑论证单元</div>
          <div className="ctx-item danger" onClick={() => deleteNode(menu.node)}>删除论证单元</div>
        </div>
      )}
    </div>
  );
}
