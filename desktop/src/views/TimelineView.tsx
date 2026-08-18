// 脉络时间轴（PLAN-0.1.2 项目12）：X 轴=年代（十年一格发丝线），
// 泳道=立场，节点=论证单元。SVG 自绘零依赖；颜色全部取 token。
// rows 传入 = 检索「脉络」视角（溯源数据）；rows=null = 全库投影。
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DocRow } from "../App";

interface TNode { id: string; claim?: string; thinker?: string;
                  doc_id: string; stance?: string; year?: number }

interface Props {
  rows: { arg_id: string; claim?: string; thinker?: string; doc_id: string;
          year?: number }[] | null;
  docs: DocRow[];
  notify: (msg: string) => void;
}

const LANE_H = 72;
const PAD_L = 90;

export default function TimelineView({ rows, docs, notify }: Props) {
  const [graphNodes, setGraphNodes] = useState<TNode[] | null>(null);

  useEffect(() => {
    if (rows !== null) return;   // 检索模式用传入数据
    api.get<{ nodes: { id: string; claim: string; doc_id: string;
                       stance?: string; thinker?: string }[] }>("/api/analysis/graph")
      .then((r) => setGraphNodes(r.nodes))
      .catch((e) => notify(`读取脉络数据失败: ${e}`));
  }, [rows, notify]);

  const yearOf = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const d of docs) m.set(d.doc_id, (d as { year?: number }).year ?? undefined);
    return m;
  }, [docs]);

  const nodes: TNode[] = useMemo(() => {
    if (rows !== null) {
      return rows.map((r) => ({
        id: r.arg_id, claim: r.claim, thinker: r.thinker, doc_id: r.doc_id,
        stance: docs.find((d) => d.doc_id === r.doc_id)?.stance,
        year: r.year ?? yearOf.get(r.doc_id),
      }));
    }
    return (graphNodes ?? []).map((n) => ({
      ...n, year: yearOf.get(n.doc_id),
    }));
  }, [rows, graphNodes, docs, yearOf]);

  const { lanes, minY, maxY } = useMemo(() => {
    const laneSet = [...new Set(nodes.map((n) => n.stance || "未分类"))];
    const years = nodes.map((n) => n.year).filter((y): y is number => y != null);
    return {
      lanes: laneSet,
      minY: years.length ? Math.floor(Math.min(...years) / 10) * 10 : 1900,
      maxY: years.length ? Math.ceil(Math.max(...years) / 10) * 10 : 2030,
    };
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>还没有可铺开的论证单元</p>
        <p className="muted small">导入文档并完成深度分析后，论证单元会按年代与立场在这里铺开。</p>
      </div>
    );
  }

  const span = Math.max(maxY - minY, 10);
  const width = Math.max(720, span * 14 + PAD_L + 60);
  const height = (lanes.length + 1) * LANE_H + 40;
  const xOf = (y: number) => PAD_L + ((y - minY) / span) * (width - PAD_L - 60);
  const unknownLaneY = lanes.length * LANE_H + 30;

  return (
    <div className="timeline-wrap">
      <svg width={width} height={height} className="timeline-svg">
        {/* 十年刻度发丝线 */}
        {Array.from({ length: span / 10 + 1 }, (_, i) => minY + i * 10).map((y) => (
          <g key={y}>
            <line x1={xOf(y)} y1={16} x2={xOf(y)} y2={height - 8}
                  className="tl-hairline" />
            <text x={xOf(y)} y={12} className="tl-year">{y}</text>
          </g>
        ))}
        {/* 泳道 */}
        {lanes.map((lane, li) => (
          <g key={lane}>
            <line x1={0} y1={(li + 1) * LANE_H} x2={width} y2={(li + 1) * LANE_H}
                  className="tl-lane-line" />
            <text x={8} y={(li + 1) * LANE_H - LANE_H / 2} className="tl-lane">
              {lane}</text>
          </g>
        ))}
        <text x={8} y={unknownLaneY} className="tl-lane tl-unknown">年代不详</text>
        {/* 节点 */}
        {nodes.map((n, i) => {
          const li = lanes.indexOf(n.stance || "未分类");
          const cy = (li + 1) * LANE_H - LANE_H / 2;
          const known = n.year != null;
          const cx = known ? xOf(n.year!) : PAD_L + 40 + (i % 12) * 52;
          const y = known ? cy : unknownLaneY - 6;
          return (
            <g key={n.id} className="tl-node">
              <circle cx={cx} cy={y} r={5}
                      className={"tl-dot lane-" + (li >= 0 ? (li % 6) + 1 : 0)} />
              <title>{`${n.year ?? "年代不详"} · ${n.thinker || "—"}\n${n.claim || ""}`}</title>
              {known && i % 2 === 0 && (
                <text x={cx + 8} y={y - 8} className="tl-claim">
                  {(n.claim || "").slice(0, 18)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
