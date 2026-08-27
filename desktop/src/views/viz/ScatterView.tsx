// J4 四象限散点（PLAN-0.1.5 批 5）：经济×政治坐标视图，自绘 SVG（决策 10 底子），
// 兼 J1 无 WebGL 兜底视图。X/Y/着色轴三个 Combobox 任选 22 轴，颜色走恒定红蓝色标。
import { useEffect, useRef, useState } from "react";
import Combobox from "../../components/Combobox";
import { layoutLabels } from "../../lib/labelLayout";
import { axisLabel, axisOptions, coordColor, isSuspiciousZero } from "../../lib/axes";
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
  // 0.1.7 项 5：全 0 坐标=疑似旧版兜底未提取，灰显+角标而非假装是数据
  const suspN = docs.filter((d) => isSuspiciousZero(d.coords)).length;
  // 0.1.8 V3：全零引导横幅 + 文档名标签防重叠（截 8 字，碰撞阶梯错位，仍撞聚合 +N）
  const allZero = docs.length > 0 && docs.every((d) => isSuspiciousZero(d.coords));
  const labels = layoutLabels(pts.map((d) => ({
    x: sx(d.coords[ax]), y: sy(d.coords[ay]) - 9,
    w: Math.min(8, (d.title || d.doc_id).length) * 11 + 6, h: 13,
    text: (d.title || d.doc_id).slice(0, 8),
  })));

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
        {suspN > 0 && (
          <span className="badge warn"
                title="坐标全 0 多为旧版离线兜底填充；用馆藏工具栏「重新提取坐标」修复">
            {suspN} 本疑似未提取</span>)}
      </div>
      {/* 0.1.8 V4：每图旁注一行（数据来源+口径） */}
      <div className="muted small viz-note">
        数据来源：文档 22 轴意识形态坐标 · 口径：真值 -5..+5
      </div>
      {allZero && (
        <div className="viz-nogl">坐标未提取——到馆藏点「重新提取坐标」后这里才有分布</div>
      )}
      <div ref={hostRef} className="viz-canvas" style={compact ? { minHeight: 260 } : undefined}>
        {pts.length === 0
          ? <div className="empty-state"><p>暂无坐标数据</p>
              <p className="muted small">文档完成入库分析后自动提取 22 轴意识形态坐标；
                已入库但无坐标（入库时模型未运行）可用馆藏工具栏的「重新提取坐标」。</p></div>
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
              {/* 0.1.8 V4：XY 轴刻度线+数字（0.1.7 项 10 欠账） */}
              {[-5, -2.5, 0, 2.5, 5].map((t) => (
                <g key={`tick${t}`}>
                  <line x1={sx(t)} y1={h - PAD} x2={sx(t)} y2={h - PAD + 4} className="viz-spoke" />
                  <text x={sx(t)} y={h - PAD + 15} textAnchor="middle" className="viz-axis-tag">{t}</text>
                  <line x1={PAD - 4} y1={sy(t)} x2={PAD} y2={sy(t)} className="viz-spoke" />
                  <text x={PAD - 6} y={sy(t) + 3} textAnchor="end" className="viz-axis-tag">{t}</text>
                </g>
              ))}
              {pts.map((d) => {
                const susp = isSuspiciousZero(d.coords);
                return (
                  <circle key={d.doc_id} cx={sx(d.coords[ax])} cy={sy(d.coords[ay])}
                          r={5}
                          fill={susp ? "var(--tx-4)" : coordColor(d.coords[ac] ?? 0)}
                          fillOpacity={susp ? 0.55 : 1}
                          strokeDasharray={susp ? "2 2" : undefined}
                          stroke={susp ? "var(--tx-4)" : undefined}
                          className="viz-dot">
                    <title>{`${d.title}${d.author ? " · " + d.author : ""}\n` +
                      `${axisLabel(ax)} ${d.coords[ax]} / ${axisLabel(ay)} ${d.coords[ay]}` +
                      (ac in d.coords ? ` / ${axisLabel(ac)} ${d.coords[ac]}` : "") +
                      (susp ? "\n⚠ 坐标全 0，疑似未提取（可重新提取坐标）" : "")}</title>
                  </circle>
                );
              })}
              {/* 0.1.8 V3：文档名标签（防重叠+聚合，hover 列全名） */}
              {labels.map((L, i) => L.hidden ? null : (
                <text key={`lb${i}`} x={L.x} y={L.y} textAnchor="middle"
                      className="viz-axis-tag">
                  {L.text}{L.extra ? ` +${L.extra.length}` : ""}
                  {L.extra && <title>{[L.text, ...L.extra].join("\n")}</title>}
                </text>
              ))}
            </svg>}
      </div>
    </div>
  );
}
