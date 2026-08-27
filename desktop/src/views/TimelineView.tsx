// 脉络时间轴（PLAN-0.1.2 项目 12）：X 轴=年代（十年一格发丝线），
// 泳道=立场，节点=论证单元。SVG 自绘零依赖；颜色全部取 token。
// rows 传入 = 检索「脉络」视角（溯源数据）；rows=null = 全库投影。
// 0.1.8 V5：空泳道折叠；全库无年份时不画假刻度，「年代不详」单泳道 + 顶部提示；
// 同泳道标签垂直错位防重叠（V3 阶梯规则）。
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DocRow, StanceOpt } from "../App";

interface TNode { id: string; claim?: string; thinker?: string;
                  doc_id: string; stance?: string; year?: number }

interface Props {
  rows: { arg_id: string; claim?: string; thinker?: string; doc_id: string;
          year?: number }[] | null;
  docs: DocRow[];
  stances: StanceOpt[];
  notify: (msg: string) => void;
}

const PAD_L = 90;
const NODE_R = 5;       // 0.1.9 V3：节点半径
const Y_STEP = 12;      // 蜂群垂直间距
const LANE_PAD = 18;    // 泳道上下内边距
const DENSE_N = 20;     // 单泳道节点 >20 关闭常显标签

const clip12 = (s: string) => (s.length > 12 ? s.slice(0, 12) + "…" : s);

// 年份健全値：非数/超出合理区间的年份视为未知（入“年代不详”），
// 防超大年份把刻度数组/画布宽度撑爆（RangeError: Invalid array length）
const saneYear = (y: unknown): number | undefined =>
  typeof y === "number" && Number.isFinite(y) && y >= -3000 && y <= 2600
    ? y : undefined;

export default function TimelineView({ rows, docs, stances, notify }: Props) {
  const [graphNodes, setGraphNodes] = useState<TNode[] | null>(null);

  useEffect(() => {
    if (rows !== null) return;   // 检索模式用传入数据
    api.get<{ nodes: { id: string; claim: string; doc_id: string;
                       stance?: string; thinker?: string }[] }>("/api/analysis/graph")
      .then((r) => setGraphNodes(r.nodes))
      .catch((e) => notify(`读取脉络数据失败：${e}`));
  }, [rows, notify]);

  const yearOf = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const d of docs) m.set(d.doc_id, saneYear((d as { year?: number }).year));
    return m;
  }, [docs]);

  const nodes: TNode[] = useMemo(() => {
    if (rows !== null) {
      return rows.map((r) => ({
        id: r.arg_id, claim: r.claim, thinker: r.thinker, doc_id: r.doc_id,
        stance: docs.find((d) => d.doc_id === r.doc_id)?.stance,
        year: saneYear(r.year) ?? yearOf.get(r.doc_id),
      }));
    }
    return (graphNodes ?? []).map((n) => ({
      ...n, year: yearOf.get(n.doc_id),
    }));
  }, [rows, graphNodes, docs, yearOf]);

  // 0.1.9 V3：泳道内 beeswarm 蜂群布局（x=年份锁定/无年份均布，y 贪心避让）+ 泳道高度自适应
  const layout = useMemo(() => {
    const laneSet = [...new Set(nodes.map((n) => n.stance || "未分类"))];
    const years = nodes.map((n) => n.year).filter((y): y is number => y != null);
    const minYVal = years.length ? Math.floor(Math.min(...years) / 10) * 10 : 0;
    const maxYVal = years.length ? Math.ceil(Math.max(...years) / 10) * 10 : 0;
    const span = Math.max(maxYVal - minYVal, 10);
    const hasY = years.length > 0;
    const containerWidth = 900;
    const timeWidth = span * 14 + PAD_L + 60;
    const totalWidth = hasY ? Math.max(timeWidth, containerWidth) : containerWidth;
    const avail = totalWidth - PAD_L - 60;
    const xOfYear = (y: number) => PAD_L + ((y - minYVal) / span) * avail;

    // 按立场分组
    const byLane = new Map<string, TNode[]>();
    for (const l of laneSet) byLane.set(l, []);
    nodes.forEach((n) => byLane.get(n.stance || "未分类")!.push(n));

    // 每节点 x：有年份锁定；无年份按泳道内序均布全宽
    const nodeX = new Map<string, number>();
    for (const [, ln] of byLane) {
      ln.forEach((n, idx) => {
        const x = (hasY && n.year != null)
          ? xOfYear(n.year)
          : PAD_L + (ln.length <= 1 ? avail / 2 : (idx / (ln.length - 1)) * avail);
        nodeX.set(n.id, x);
      });
    }

    // 泳道内 beeswarm：按 x 排序，贪心选禁碰撞的最小 |y|
    const nodeY = new Map<string, number>();
    const laneHeights: number[] = [];
    for (const lane of laneSet) {
      const ln = [...byLane.get(lane)!].sort((a, b) => nodeX.get(a.id)! - nodeX.get(b.id)!);
      const placed: { x: number; y: number }[] = [];
      let maxAbs = 0;
      for (const n of ln) {
        const x = nodeX.get(n.id)!;
        const neigh = placed.filter((p) => Math.abs(p.x - x) < 2 * NODE_R);
        const cands = [0];
        for (const p of neigh) cands.push(p.y + Y_STEP, p.y - Y_STEP);
        cands.sort((a, b) => Math.abs(a) - Math.abs(b));
        let chosen = 0;
        for (const cy of cands) {
          if (neigh.every((p) => Math.abs(cy - p.y) >= Y_STEP - 0.5)) { chosen = cy; break; }
        }
        nodeY.set(n.id, chosen);
        placed.push({ x, y: chosen });
        maxAbs = Math.max(maxAbs, Math.abs(chosen));
      }
      laneHeights.push(2 * (maxAbs + NODE_R) + 2 * LANE_PAD);
    }
    // 泳道累加顶部（总高=Σ泳道实际高）
    const laneTop: number[] = [];
    let acc = 28;
    for (const h of laneHeights) { laneTop.push(acc); acc += h; }

    return { lanes: laneSet, minY: minYVal, maxY: maxYVal, width: totalWidth,
             height: acc + 16, xOf: xOfYear, hasYears: hasY, nodeX, nodeY,
             laneTop, laneHeights,
             denseLanes: new Set(laneSet.filter((l) => byLane.get(l)!.length > DENSE_N)) };
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>还没有可铺开的论证单元</p>
        <p className="muted small">导入文档并完成深度分析后，论证单元会按年代与立场在这里铺开。</p>
      </div>
    );
  }

  return (
    <div className="timeline-wrap">
      {/* V5：全库年份缺失——不画假刻度 */}
      {!layout.hasYears && (
        <p className="muted small" style={{ padding: "6px 14px", margin: 0 }}>
          年份未提取，暂按导入序在泳道内蜂群排布
        </p>
      )}
      {/* 0.1.9 V3：密度感知提示 */}
      {layout.denseLanes.size > 0 && (
        <p className="muted small" style={{ padding: "0 14px 4px", margin: 0 }}>
          节点较多，悬停查看标题
        </p>
      )}
      <svg width="100%" height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}
           className="timeline-svg" preserveAspectRatio="xMinYMin meet">
        {/* 刻度发丝线 */}
        {layout.hasYears && (() => {
          let step = 10;
          while ((layout.maxY - layout.minY) / step > 40) step *= 10;
          const ticks: number[] = [];
          for (let y = layout.minY; y <= layout.maxY && ticks.length < 100; y += step) ticks.push(y);
          return ticks;
        })().map((y) => (
          <g key={y}>
            <line x1={layout.xOf(y)} y1={16} x2={layout.xOf(y)} y2={layout.height - 8}
                  className="tl-hairline" />
            <text x={layout.xOf(y)} y={12} className="tl-year">{y}</text>
          </g>
        ))}
        {/* 泳道（自适应高度，底线分隔） */}
        {layout.lanes.map((lane, li) => {
          const cy = layout.laneTop[li] + layout.laneHeights[li] / 2;
          const bottom = layout.laneTop[li] + layout.laneHeights[li];
          return (
            <g key={lane}>
              <line x1={0} y1={bottom} x2={layout.width} y2={bottom} className="tl-lane-line" />
              <text x={8} y={cy} className="tl-lane">
                {clip12(stances.find((s) => s.name === lane)?.label || lane)}</text>
            </g>
          );
        })}
        {/* 节点：泳道内 beeswarm；密集泳道关闭常显标签（仅 hover 显） */}
        {nodes.map((n) => {
          const li = layout.lanes.indexOf(n.stance || "未分类");
          if (li < 0) return null;
          const cx = layout.nodeX.get(n.id) ?? PAD_L;
          const cy = layout.laneTop[li] + layout.laneHeights[li] / 2 + (layout.nodeY.get(n.id) ?? 0);
          const dense = layout.denseLanes.has(n.stance || "未分类");
          return (
            <g key={n.id} className="tl-node">
              <circle cx={cx} cy={cy} r={NODE_R}
                      className={`tl-dot lane-${(li % 6) + 1}`}>
                <title>{n.claim || n.id}{n.thinker ? ` · ${n.thinker}` : ""}</title>
              </circle>
              {!dense && (
                <text x={cx + 8} y={cy - 8} className="tl-claim">
                  {clip12(n.claim || "")}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
