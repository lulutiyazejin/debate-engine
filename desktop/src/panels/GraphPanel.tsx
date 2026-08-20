// 图谱面板（项目16）：节点=论证单元，边=支持(绿)/攻击(红)/细化(蓝虚)
// 按立场/文档过滤；「生成关系」调对齐引擎写边；节点右键=编辑/删除（人工纠错）
import { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api } from "../api";
import { askConfirm, askInput } from "../components/AppDialog";
import { setUiPref } from "../lib/uiPrefs";
import type { DocRow } from "../App";
import Combobox from "../components/Combobox";

interface GNode { id: string; claim: string; doc_id: string; doc_title: string; stance?: string; thinker?: string; x?: number; y?: number }
interface GLink { source: string | GNode; target: string | GNode; relation: string }

interface Props {
  stances: { name: string; label: string }[];
  docs: DocRow[];
  notify: (msg: string) => void;
  active: boolean;
  onChain?: (anchor: string) => void;   // 节点右键 → 逻辑链入口（项目14）
  onShowDoc?: (doc: DocRow) => void;    // 批 2/23：combobox 选中项旁「查看」开右栏
}

// 颜色一律取 token（项目24：主题切换时画布同步换色）
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
  return v || fallback;
}

const RELATIONS = ["support", "attack", "refine", "evolve", "analogy", "oppose"] as const;
const REL_LABEL: Record<string, string> = {
  support: "支持", attack: "攻击", refine: "细化",
  evolve: "演进", analogy: "类比", oppose: "同题对立",
};

function edgeColor(rel: string): string {
  switch (rel) {
    case "support": return cssVar("--ok", "#3fb96a");
    case "attack": return cssVar("--err", "#e05b5b");
    case "refine": return cssVar("--stance-1", "#4f8cff");
    case "evolve": return cssVar("--warn", "#d9a441");
    case "analogy": return cssVar("--stance-6", "#5bc8c8");
    case "oppose": return cssVar("--accent", "#d3543f");
    default: return cssVar("--tx-4", "#666");
  }
}

export default function GraphPanel({ stances, docs, notify, active, onChain,
                                     onShowDoc }: Props) {
  const [stance, setStance] = useState("");
  const [docId, setDocId] = useState("");
  const [relFilter, setRelFilter] = useState<string[]>([]);   // 空=全部
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const [building, setBuilding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GNode } | null>(null);
  // 0.1.6 项 6：节点标签常显开关（不悬停也显名），偏好持久化
  const [showLabels, setShowLabels] = useState(
    () => localStorage.getItem("de.graph.labels") === "1");
  const [size, setSize] = useState({ w: 800, h: 520 });
  const hostRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);          // 批 1：显式管缩放的图谱实例
  const freshLoad = useRef(false);          // 批 1：仅全量重载后拟合镜头
  const relFilterRef = useRef(relFilter);   // 0.1.5 I8：linkVisibility 读 ref，不换 graphData
  relFilterRef.current = relFilter;
  const lastKey = useRef("");               // 0.1.5 I8 保险：同过滤回切保镜头

  const stanceColor = useCallback((s?: string) => {
    const i = stances.findIndex((x) => x.name === s);
    return cssVar(`--stance-${(((i < 0 ? 0 : i) % 6) + 1)}`, "#7d9ec7");
  }, [stances]);

  const load = useCallback(async (preserveCam = false) => {
    try {
      const q = new URLSearchParams();
      if (stance) q.set("stance", stance);
      if (docId) q.set("doc_id", docId);
      const r = await api.get<{ nodes: GNode[]; links: GLink[] }>(
        `/api/analysis/graph?${q}`);
      // 0.1.5 I8 保险：真换数据路径——换前读镜头换后写回（同过滤重拉/纠错回写）；
      // 过滤变化才走 freshLoad 拟合
      let cam: { k: number; x: number; y: number } | null = null;
      if (preserveCam && fgRef.current) {
        const c = fgRef.current.centerAt();
        cam = { k: fgRef.current.zoom(), x: c.x, y: c.y };
      }
      freshLoad.current = !cam;
      setData(r);
      if (cam) {
        // 下一帧写回（引擎接管新数据后）；用户此刻无法插入滚轮操作，不会覆盖用户镜头
        requestAnimationFrame(() => {
          if (fgRef.current && cam) {
            fgRef.current.centerAt(cam.x, cam.y, 0);
            fgRef.current.zoom(cam.k, 0);
          }
        });
      }
    } catch (e) {
      notify(`加载图谱失败: ${e}`);
    }
  }, [stance, docId, notify]);

  useEffect(() => {
    if (!active) return;
    const key = `${stance}|${docId}`;
    load(key === lastKey.current);   // 同过滤回切 → 保镜头；换过滤 → 拟合
    lastKey.current = key;
  }, [active, load, stance, docId]);

  // 0.1.5 I1：always-mount 后离面时暂停力导引擎，回面恢复
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (active) fg.resumeAnimation?.(); else fg.pauseAnimation?.();
  }, [active]);

  // 容器自适应（批 1：等值守卫斩断「测量→setState→重排→再测量」自反馈回环）
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h) ? prev : { w, h });
    });
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
      load(true);   // I8：同过滤重拉，保镜头
    } catch (e) {
      notify(`生成关系失败: ${e}`);
    } finally {
      setBuilding(false);
    }
  };

  const deleteNode = async (node: GNode) => {
    setMenu(null);
    if (!(await askConfirm({ title: "删除论证单元？",
        body: `「${node.claim}」`, danger: true }))) return;
    try {
      await api.del(`/api/analysis/units/${node.id}`);
      notify("已删除");
      load(true);
    } catch (e) {
      notify(`删除失败: ${e}`);
    }
  };

  const editNode = async (node: GNode) => {
    setMenu(null);
    const claim = await askInput({ title: "修正论点内容", initial: node.claim });
    if (claim === null || claim.trim() === "" || claim === node.claim) return;
    try {
      await api.patch(`/api/analysis/units/${node.id}`, { claim: claim.trim() });
      notify("已修正");
      load(true);
    } catch (e) {
      notify(`修正失败: ${e}`);
    }
  };

  return (
    <div className="panel graph" style={{ padding: 0, gap: 0 }}>
      <div className="controls" style={{ padding: "10px 14px" }}>
        <label>立场
          <Combobox width={180} value={stance} onChange={setStance}
                    placeholder="全部" scopeLabel="立场名"
                    options={[{ value: "", label: "全部" },
                              ...stances.map((s) => ({ value: s.name, label: s.label }))]} />
        </label>
        <label>文档
          <Combobox width={240} value={docId} onChange={setDocId}
                    placeholder="全部" scopeLabel="馆藏标题/作者"
                    onView={onShowDoc ? (v) => {
                      const d = docs.find((x) => x.doc_id === v);
                      if (d) onShowDoc(d);
                    } : undefined}
                    options={[{ value: "", label: "全部" },
                              ...docs.map((d) => ({ value: d.doc_id,
                                label: d.title || d.doc_id,
                                sub: (d.author as string) || undefined }))]} />
        </label>
        <button className="primary" onClick={buildRelations} disabled={building}>
          {building ? "对齐判定中…" : "生成/更新关系边"}
        </button>
        <label className="chk">
          <input type="checkbox" checked={showLabels}
                 onChange={(e) => { setShowLabels(e.target.checked);
                   setUiPref("de.graph.labels", e.target.checked ? "1" : "0"); }} />
          常显节点标签</label>
        <span className="muted small">
          {data.nodes.length} 节点 · {data.links.length} 边 · 节点右键可纠错
        </span>
      </div>
      {/* 关系 chips 过滤条（项目13）：多选，带计数与 token 色 */}
      <div className="chip-bar">
        {RELATIONS.map((r) => {
          const n = data.links.filter((l) => l.relation === r).length;
          const on = relFilter.length === 0 || relFilter.includes(r);
          return (
            <button key={r} className={"chip" + (on ? " chip-on" : "")}
                    style={{ borderColor: edgeColor(r) }}
                    onClick={() => setRelFilter((prev) =>
                      prev.includes(r) ? prev.filter((x) => x !== r)
                        : [...prev, r])}>
              <i style={{ background: edgeColor(r) }} />{REL_LABEL[r]} {n}
            </button>
          );
        })}
        {/* 0.1.5 J10：「全部」复位钮滑移化（常驻占位，120ms 透明度出场） */}
        <button className={"link chip-clear" + (relFilter.length > 0 ? " on" : "")}
                onClick={() => setRelFilter([])}>全部</button>
      </div>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {data.nodes.length === 0
          ? <div className="empty-state">
              <p>暂无论证单元</p>
              <p className="muted small">导入文档后单元自动提取；点「生成/更新关系边」建立连线（离线时可用否定词规则判定同题对立）。</p>
            </div>
          : <ForceGraph2D
              ref={fgRef}
              /* 0.1.5 I8 主解：chip 过滤走视图层显隐（linkVisibility），
                 graphData 恒同对象——引擎零重热，连点不缩不漂（社区 #531 定论） */
              graphData={data}
              linkVisibility={(l: GLink) =>
                relFilterRef.current.length === 0 ||
                relFilterRef.current.includes(l.relation)}
              width={size.w}
              height={size.h}
              cooldownTicks={100}
              onEngineStop={() => {
                // 只在全量重载后拟合一次镜头；chip 过滤/选档保持视口（批 1，决策 18）
                if (freshLoad.current) {
                  freshLoad.current = false;
                  fgRef.current?.zoomToFit(300, 40);
                }
              }}
              backgroundColor={cssVar("--canvas-bg", "#16181d")}
              nodeLabel={(n: GNode) => `${n.claim}\n——${n.thinker || n.doc_title}`}
              nodeColor={(n: GNode) => stanceColor(n.stance)}
              nodeRelSize={5}
              /* 项 6：常显标签叠在节点下方，论点截 12 字；关闭时仍悬停 nodeLabel */
              nodeCanvasObjectMode={() => (showLabels ? "after" : undefined)}
              nodeCanvasObject={(n: GNode, c: CanvasRenderingContext2D, scale: number) => {
                if (!showLabels || n.x === undefined || n.y === undefined) return;
                const txt = n.claim.length > 12 ? n.claim.slice(0, 12) + "…" : n.claim;
                const fs = Math.max(2.5, 11 / scale);
                c.save();
                c.font = `${fs}px "Microsoft YaHei",sans-serif`;
                c.textAlign = "center"; c.textBaseline = "top";
                c.lineWidth = fs / 4;
                c.strokeStyle = cssVar("--canvas-bg", "#16181d");
                c.strokeText(txt, n.x, n.y + 7 / scale);
                c.fillStyle = cssVar("--tx-2", "#c8c4bc");
                c.fillText(txt, n.x, n.y + 7 / scale);
                c.restore();
              }}
              linkColor={(l: GLink) => edgeColor(l.relation)}
              linkWidth={2}
              linkLineDash={(l: GLink) => (l.relation === "refine" || l.relation === "analogy" ? [4, 3] : null)}
              linkDirectionalArrowLength={(l: GLink) =>
                relFilterRef.current.length === 0 ||
                relFilterRef.current.includes(l.relation) ? 5 : 0}
              onNodeRightClick={(n: GNode, e: MouseEvent) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node: n });
              }}
              onBackgroundClick={() => setMenu(null)}
            />}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {onChain && (
            <div className="ctx-item" onClick={() => { setMenu(null); onChain(menu.node.claim); }}>
              查看此论点的逻辑链</div>
          )}
          <div className="ctx-item" onClick={() => editNode(menu.node)}>编辑论证单元</div>
          <div className="ctx-item danger" onClick={() => deleteNode(menu.node)}>删除论证单元</div>
        </div>
      )}
    </div>
  );
}
