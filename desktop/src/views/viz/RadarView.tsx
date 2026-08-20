// J4 立场雷达（PLAN-0.1.5 批 5）：22 轴多边形立场画像，自绘 SVG；
// 每立场一个半透明多边形，chips 开关叠加对比；颜色走 --stance-N token。
import { useEffect, useMemo, useRef, useState } from "react";
import { AXES } from "../../lib/axes";
import type { StanceProfile } from "../../lib/axes";

interface Props {
  profiles: StanceProfile[];
  stanceLabel: (name: string) => string;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function RadarView({ profiles, stanceLabel }: Props) {
  const usable = useMemo(() =>
    profiles.filter((p) => p.count > 0 && Object.keys(p.avg).length > 0), [profiles]);
  const [on, setOn] = useState<string[]>([]);          // 空=前 3 个默认亮
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

  const active = on.length > 0 ? on
    : usable.slice(0, 3).map((p) => p.stance);
  const color = (s: string) => {
    const i = usable.findIndex((p) => p.stance === s);
    return cssVar(`--stance-${((i < 0 ? 0 : i) % 6) + 1}`, "#7d9ec7");
  };

  const { w, h } = size;
  const cx = w / 2, cy = h / 2, R = Math.max(60, Math.min(w, h) / 2 - 64);
  const n = AXES.length;
  // 轴角度：12 点起顺时针；值域 -5..+5 → 半径 0..R（-5 圆心 +5 外圈）
  const pt = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = ((Math.max(-5, Math.min(5, v)) + 5) / 10) * R;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };

  return (
    <div className="viz-view">
      <div className="chip-bar" style={{ paddingTop: 8 }}>
        {usable.map((p) => {
          const lit = active.includes(p.stance);
          return (
            <button key={p.stance} className={"chip" + (lit ? " chip-on" : "")}
                    style={{ borderColor: color(p.stance) }}
                    onClick={() => setOn((prev) => {
                      const base = prev.length > 0 ? prev : active;
                      return base.includes(p.stance)
                        ? base.filter((x) => x !== p.stance)
                        : [...base, p.stance];
                    })}>
              <i style={{ background: color(p.stance) }} />
              {stanceLabel(p.stance) || "未分类"} {p.count}
            </button>
          );
        })}
      </div>
      <div ref={hostRef} className="viz-canvas">
        {usable.length === 0
          ? <div className="empty-state"><p>暂无立场画像</p>
              <p className="muted small">入库文档带 22 轴坐标后，按立场聚合出画像多边形。</p></div>
          : <svg width={w} height={h}>
              {/* 同心参考环（-5 / -2.5 / 0 / 2.5 / 5 五档） */}
              {[0.25, 0.5, 0.75, 1].map((k) => (
                <circle key={k} cx={cx} cy={cy} r={R * k} className="viz-ring" />
              ))}
              {AXES.map((a, i) => {
                const [x2, y2] = pt(i, 5);
                const [lx, ly] = [cx + (x2 - cx) * 1.09, cy + (y2 - cy) * 1.09];
                return (
                  <g key={a.key}>
                    <line x1={cx} y1={cy} x2={x2} y2={y2} className="viz-spoke" />
                    <text x={lx} y={ly} textAnchor="middle" className="viz-axis-tag">
                      {a.label}</text>
                  </g>
                );
              })}
              {usable.filter((p) => active.includes(p.stance)).map((p) => {
                const d = AXES.map((a, i) => pt(i, p.avg[a.key] ?? 0))
                  .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
                  .join(" ") + " Z";
                return (
                  <path key={p.stance} d={d} fill={color(p.stance)} fillOpacity={0.14}
                        stroke={color(p.stance)} strokeWidth={1.6}>
                    <title>{stanceLabel(p.stance) || "未分类"} · {p.count} 本</title>
                  </path>
                );
              })}
            </svg>}
      </div>
    </div>
  );
}
