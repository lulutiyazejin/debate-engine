// J4 四象限散点（PLAN-0.1.5 批 5）：经济×政治坐标视图，自绘 SVG（决策 10 底子），
// 兼 J1 无 WebGL 兜底视图。X/Y/着色轴三个 Combobox 任选 22 轴，颜色走恒定红蓝色标。
import { useEffect, useRef, useState } from "react";
import Combobox from "../../components/Combobox";
import { axisLabel, axisOptions, coordColor } from "../../lib/axes";
import type { CoordDoc } from "../../lib/axes";

interface Props {
  docs: CoordDoc[];
  compact?: boolean;   // 兜底嵌入 CubeView 时收紧留白
}

const PAD = 42;

export default function ScatterView({ docs, compact }: Props) {
  const [ax, setAx] = useState("ownership");
  const [ay, setAy] = useState("political_authority");
  const [ac, setAc] = useState("political_authority");
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 420 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      setSize((p) => (p.w === w && p.h === h) ? p : { w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const sx = (v: number) => PAD + ((v + 5) / 10) * (w - PAD * 2);
  const sy = (v: number) => (h - PAD) - ((v + 5) / 10) * (h - PAD * 2);
  const pts = docs.filter((d) => ax in d.coords && ay in d.coords);

  return (
    <div className="viz-view">
      <div className="controls viz-controls">
        <label>横轴
          <Combobox width={150} value={ax} onChange={setAx}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>纵轴
          <Combobox width={150} value={ay} onChange={setAy}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>着色轴
          <Combobox width={150} value={ac} onChange={setAc}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <span className="muted small">{pts.length} / {docs.length} 本有此二轴坐标</span>
      </div>
      <div ref={hostRef} className="viz-canvas" style={compact ? { minHeight: 260 } : undefined}>
        {pts.length === 0
          ? <div className="empty-state"><p>暂无坐标数据</p>
              <p className="muted small">文档完成入库分析后自动提取 22 轴意识形态坐标。</p></div>
          : <svg width={w} height={h}>
              {/* 象限参考线（0 点十字） */}
              <line x1={sx(0)} y1={PAD} x2={sx(0)} y2={h - PAD} className="viz-zero" />
              <line x1={PAD} y1={sy(0)} x2={w - PAD} y2={sy(0)} className="viz-zero" />
              <rect x={PAD} y={PAD} width={w - PAD * 2} height={h - PAD * 2}
                    className="viz-frame" />
              {/* 端点语义标注 */}
              <text x={PAD} y={sy(0) - 6} className="viz-axis-tag">
                {axisOptions.find((o) => o.value === ax)?.sub?.split(" ←→ ")[0]}</text>
              <text x={w - PAD} y={sy(0) - 6} textAnchor="end" className="viz-axis-tag">
                {axisOptions.find((o) => o.value === ax)?.sub?.split(" ←→ ")[1]}</text>
              <text x={sx(0) + 6} y={h - PAD - 4} className="viz-axis-tag">
                {axisOptions.find((o) => o.value === ay)?.sub?.split(" ←→ ")[0]}</text>
              <text x={sx(0) + 6} y={PAD + 12} className="viz-axis-tag">
                {axisOptions.find((o) => o.value === ay)?.sub?.split(" ←→ ")[1]}</text>
              <text x={w / 2} y={h - 10} textAnchor="middle" className="viz-axis-title">
                {axisLabel(ax)}</text>
              <text x={14} y={h / 2} textAnchor="middle" className="viz-axis-title"
                    transform={`rotate(-90 14 ${h / 2})`}>{axisLabel(ay)}</text>
              {pts.map((d) => (
                <circle key={d.doc_id} cx={sx(d.coords[ax])} cy={sy(d.coords[ay])}
                        r={5} fill={coordColor(d.coords[ac] ?? 0)}
                        className="viz-dot">
                  <title>{`${d.title}${d.author ? " · " + d.author : ""}\n` +
                    `${axisLabel(ax)} ${d.coords[ax]} / ${axisLabel(ay)} ${d.coords[ay]}` +
                    (ac in d.coords ? ` / ${axisLabel(ac)} ${d.coords[ac]}` : "")}</title>
                </circle>
              ))}
            </svg>}
      </div>
    </div>
  );
}
