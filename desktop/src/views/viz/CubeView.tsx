// 0.1.6 项 5:3D 立方自绘重写 (PLAN-0.1.6 批 4,视觉基准 cube-demo.html)。
// 零依赖 canvas 2D 弱透视投影(f=80),替换 @antv 3D 链(WebGL 兜底问题一并消失):
// 大立方三轴 RGB 渐变场(轴色可自选)、方格只画面朝视角的三个内壁、
// 立场=1×1×1 小立方 (中心=该立场文档三轴均值，未分类硬钉原点)、
// 文档=场色圆点、公告牌文字远→近排序;拖转/滚轮缩放/悬停提示/复位。
// 偏好(轴色/透明度/反向/常显标签)经 setUiPref 双写持久化(项 7 键 de.cube.*)。
import { useCallback, useEffect, useRef, useState } from "react";
import Combobox from "../../components/Combobox";
import { axisOptions, isSuspiciousZero, AXES } from "../../lib/axes";
import { layoutLabels } from "../../lib/labelLayout";
import type { CoordDoc } from "../../lib/axes";
import { setUiPref } from "../../lib/uiPrefs";

interface Props {
  docs: CoordDoc[];
  active: boolean;
  stances: { name: string; label: string }[];
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
  return v || fallback;
}

const DEF_COLS = ["#ff0000", "#00ff00", "#0000ff"];
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/* 小立方框线顶点序 */
const BOX_F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4],
               [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];

interface Row { s: string; t: string; c: number[] }
interface Box { s: string; name: string; cen: number[]; n: number }
interface Proj { x: number; y: number; d: number; s: number }
type Hit = { kind: "box"; b: Box; p: Proj; r: number }
         | { kind: "dot"; doc: Row; p: Proj; r: number };

function loadCols(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("de.cube.cols") || "");
    if (Array.isArray(v) && v.length === 3 &&
        v.every((c) => /^#[0-9a-f]{6}$/i.test(c))) return v;
  } catch { /* 缺省 */ }
  return [...DEF_COLS];
}

export default function CubeView({ docs, active, stances }: Props) {
  const [ax, setAx] = useState("ownership");
  const [ay, setAy] = useState("political_authority");
  const [az, setAz] = useState("imperialism");
  // 项 6:中心立场选择器 (选后所有立场/文档坐标减该均值→相对坐标)
  const [centerStance, setCenterStance] = useState("");   // ""=原点 (绝对坐标)
  // 项 7:距离虚线开关 (默认关)
  const [showDistLines, setShowDistLines] = useState(false);
  const [cols, setCols] = useState<string[]>(loadCols());
  const [alpha, setAlpha] = useState(() => {
    const v = parseInt(localStorage.getItem("de.cube.alpha") || "18", 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(90, v)) : 18;
  });
  const [invert, setInvert] = useState(
    () => localStorage.getItem("de.cube.invert") !== "0");   // 默认开
  const [labels, setLabels] = useState(
    () => localStorage.getItem("de.cube.labels") !== "0");   // 默认开
  const hostRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: 0.7, pitch: -0.42, zoom: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<Hit | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const draw = useCallback(() => {
    const cv = cvRef.current, host = hostRef.current;
    if (!cv || !host) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = host.clientWidth, H = host.clientHeight;
    if (W < 10 || H < 10) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + "px"; cv.style.height = H + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { yaw, pitch, zoom } = view.current;
    const txMain = cssVar("--tx-1", "#e8e5df");
    const a01 = alpha / 100;
    const project = (p: number[]): Proj => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1];
      const y2 = y * cp - z * sp, z2 = y * sp + z * cp;
      const f = 80, s = f / (f + (z2 / 5) * 6) * zoom;   // 弱透视:小立方更像正方
      const R = Math.min(W, H) * 0.07;   // 0.1.9 V1: 大立方恢复，撤回 0.062（微调上限 0.075）
      return { x: W / 2 + x * R * s, y: H / 2 - y2 * R * s, d: z2, s };
    };
    const rgb = cols.map(hex2rgb);
    const fieldColor = (c: number[]) => {
      const o = [0, 1, 2].map((i) => Math.min(255,
        rgb.reduce((s, col, k) => s + col[i] * (c[k] + 5) / 10, 0)) | 0);
      return `rgb(${o})`;
    };
    // 0.1.9 V1：大立方几何（±5 立方体，六面渐变场 + 内壁方格 + 线框 + 0 点虚线 + 轴端标注）
    const CV: number[][] = [];
    for (let i = 0; i < 8; i++) CV.push([i & 1 ? 5 : -5, i & 2 ? 5 : -5, i & 4 ? 5 : -5]);
    const FACES = [
      { v: [0, 1, 3, 2], axf: 0, val: -5 }, { v: [4, 5, 7, 6], axf: 0, val: 5 },
      { v: [0, 1, 5, 4], axf: 1, val: -5 }, { v: [2, 3, 7, 6], axf: 1, val: 5 },
      { v: [0, 2, 6, 4], axf: 2, val: -5 }, { v: [1, 3, 7, 5], axf: 2, val: 5 },
    ];
    const AXN: [string, string][] = [ax, ay, az].map((k) => {
      const m = AXES.find((a2) => a2.key === k); return m ? [m.neg, m.pos] : ["-", "+"];
    }) as [string, string][];
    const gridCol = cssVar("--tx-4", "rgba(138,131,117,.55)");
    const wireCol = cssVar("--tx-2", "rgba(232,229,223,.8)");
    const halo = cssVar("--bg-0", "#16181d");
    const capCol = cssVar("--tx-3", "#8a8378");
    const drawCube = () => {
      const P = CV.map(project);
      const order = FACES.map((f) => ({ f, d: f.v.reduce((s, i) => s + P[i].d, 0) / 4 }))
        .sort((a2, b2) => b2.d - a2.d);   // 远→近
      for (const { f } of order) {
        const [pa, pb, pc, pd] = f.v.map((i) => P[i]);
        ctx.save(); ctx.globalAlpha = a01;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
        ctx.lineTo(pc.x, pc.y); ctx.lineTo(pd.x, pd.y); ctx.closePath();
        const chans = [0, 1, 2].filter((x) => x !== f.axf);
        const base = rgb[f.axf].map((v) => (v * (f.val + 5) / 10) | 0);
        ctx.fillStyle = `rgb(${base})`; ctx.fill();
        const g1 = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
        g1.addColorStop(0, `rgba(${rgb[chans[0]]},0)`);
        g1.addColorStop(1, `rgba(${rgb[chans[0]]},1)`);
        ctx.fillStyle = g1; ctx.fill();
        const g2 = ctx.createLinearGradient(pa.x, pa.y, pd.x, pd.y);
        g2.addColorStop(0, `rgba(${rgb[chans[1]]},0)`);
        g2.addColorStop(1, `rgba(${rgb[chans[1]]},1)`);
        ctx.fillStyle = g2; ctx.fill();
        ctx.restore();
      }
      // 内壁方格：只画面朝视角的三个远壁
      ctx.save(); ctx.lineWidth = 1.0; ctx.strokeStyle = gridCol;
      for (const o of order.slice(0, 3)) {
        const f = o.f; const axes2 = [0, 1, 2].filter((x) => x !== f.axf);
        for (let k = 1; k < 5; k++) {
          const t = -5 + k * 2;
          for (const [u, w] of [[axes2[0], axes2[1]], [axes2[1], axes2[0]]]) {
            const p1 = [0, 0, 0], p2 = [0, 0, 0];
            p1[f.axf] = p2[f.axf] = f.val; p1[u] = t; p2[u] = t; p1[w] = -5; p2[w] = 5;
            const q1 = project(p1), q2 = project(p2);
            ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
          }
        }
      }
      ctx.restore();
      // 线框
      ctx.save(); ctx.strokeStyle = wireCol; ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const diff = i ^ j;
        if (diff === 1 || diff === 2 || diff === 4) {
          ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke();
        }
      }
      // 三轴 0 点虚线
      ctx.setLineDash([4, 4]); ctx.strokeStyle = gridCol;
      for (const axi of [0, 1, 2]) {
        const p1 = [0, 0, 0], p2 = [0, 0, 0]; p1[axi] = -5; p2[axi] = 5;
        const q1 = project(p1), q2 = project(p2);
        ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      // 轴端标注（neg/pos 语义，与 axes.ts 一致）
      ctx.font = "600 12px 'Microsoft YaHei',sans-serif"; ctx.textAlign = "center";
      for (const axi of [0, 1, 2]) {
        for (const [end, txt] of [[-1, AXN[axi][0]], [1, AXN[axi][1]]] as [number, string][]) {
          const p = [0, 0, 0]; p[axi] = end * 5.9;
          const q = project(p);
          ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(txt, q.x, q.y);
          ctx.fillStyle = capCol; ctx.fillText(txt, q.x, q.y);
        }
      }
      ctx.restore();
    };
    drawCube();   // 先画大立方（在小立方/点之后）
    // 0.1.9 V1：两遍算法——先算全部立场 rawCen，再取 centerStance 均值统一减偏移
    const rows: Row[] = docs
      .filter((d) => ax in d.coords && ay in d.coords && az in d.coords)
      .map((d) => ({ s: d.stance || "",
                     t: `${d.title}${d.author ? " · " + d.author : ""}`,
                     c: [d.coords[ax], d.coords[ay], d.coords[az]] }));
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const g = groups.get(r.s);
      if (g) g.push(r); else groups.set(r.s, [r]);
    }
    // 第一遍：各立场绝对均值 rawCen
    const rawCens = new Map<string, number[]>();
    for (const [s, g] of groups) {
      rawCens.set(s, [0, 1, 2].map((i) => Math.max(-4.5, Math.min(4.5,
        g.reduce((a2, d) => a2 + d.c[i], 0) / g.length))));
    }
    // 偏移源：centerStance 的 rawCen（未选=原点）；文档点、小立方、命中表同一偏移源
    const off = (centerStance && rawCens.has(centerStance))
      ? rawCens.get(centerStance)! : [0, 0, 0];
    const shift = (c: number[]) => [c[0] - off[0], c[1] - off[1], c[2] - off[2]];
    // 第二遍：小立方统一减偏移
    const boxes: Box[] = [...groups.entries()].map(([s, g]) => {
      const cen = shift(rawCens.get(s)!);
      return { s, name: s === "" ? "未分类" : (stances.find((x) => x.name === s)?.label || s),
               cen, n: g.length };
    });
    const stanceColor = (s: string) => {
      if (s === "") return cssVar("--tx-3", "#8a8378");
      const i = stances.findIndex((x) => x.name === s);
      return cssVar(`--stance-${(((i < 0 ? 0 : i) % 6) + 1)}`, "#7d9ec7");
    };
    const drawBox = (b: Box, colr: string, a2: number) => {
      const vs: Proj[] = [];
      for (let i = 0; i < 8; i++)
        vs.push(project([b.cen[0] + (i & 1 ? 0.5 : -0.5),
                         b.cen[1] + (i & 2 ? 0.5 : -0.5),
                         b.cen[2] + (i & 4 ? 0.5 : -0.5)]));
      ctx.save(); ctx.globalAlpha = a2; ctx.fillStyle = colr;
      for (const f of BOX_F) {
        ctx.beginPath(); ctx.moveTo(vs[f[0]].x, vs[f[0]].y);
        for (const i of f.slice(1)) ctx.lineTo(vs[i].x, vs[i].y);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, a2 * 3 + 0.35);
      ctx.strokeStyle = colr; ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const d2 = i ^ j;
        if (d2 === 1 || d2 === 2 || d2 === 4) {
          ctx.beginPath(); ctx.moveTo(vs[i].x, vs[i].y);
          ctx.lineTo(vs[j].x, vs[j].y); ctx.stroke();
        }
      }
      ctx.restore();
    };
    /* 深度队列:小立方 → 圆点，统一远→近;文字最后公告牌化 */
    const hover = hoverRef.current;
    type Item = { d: number; kind: "box"; b: Box } | { d: number; kind: "dot"; p: Proj; doc: Row };
    const items: Item[] = [];
    for (const b of boxes) items.push({ d: project(b.cen).d, kind: "box", b });
    for (const r of rows) {
      const p = project(shift(r.c));
      items.push({ d: p.d, kind: "dot", p, doc: r });
    }
    items.sort((a2, b2) => b2.d - a2.d);
    const texts: { c: Proj; dep: number; txt: string; col: string; big: boolean }[] = [];
    for (const it of items) {
      if (it.kind === "box") {
        drawBox(it.b, stanceColor(it.b.s), Math.min(0.5, a01 * 0.8 + 0.06));
        const c = project(it.b.cen);
        const hot = hover?.kind === "box" && hover.b.s === it.b.s;
        if (labels || hot)
          texts.push({ c, dep: c.d, txt: `${it.b.name} · ${it.b.n}`,
                       col: stanceColor(it.b.s), big: true });
      } else {
        ctx.save();
        ctx.fillStyle = fieldColor(it.doc.c);
        ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1;
        const r2 = Math.max(2.5, 4.5 * it.p.s);
        ctx.beginPath(); ctx.arc(it.p.x, it.p.y, r2, 0, 7); ctx.fill(); ctx.stroke();
        ctx.restore();
        const hot = hover?.kind === "dot" && hover.doc.t === it.doc.t;
        if (hot) texts.push({ c: it.p, dep: it.d, txt: it.doc.t, col: txMain, big: false });
      }
    }
    texts.sort((a2, b2) => b2.dep - a2.dep);
    // 0.1.8 V3：公告牌标签防重叠（阶梯错位，仍撞聚合 +N，hover 仍可逐个读名）
    const laid = layoutLabels(texts.map((t) => {
      const fs = Math.max(10, Math.min(20, 13 * t.c.s));
      return { x: t.c.x, y: t.c.y - (t.big ? 14 * t.c.s : 10),
               w: t.txt.length * fs * 0.62 + 6, h: fs + 2, text: t.txt };
    }));
    texts.forEach((t, i) => {
      const L = laid[i];
      if (L.hidden) return;
      const fs = Math.max(10, Math.min(20, 13 * t.c.s));
      ctx.save();
      ctx.font = `${t.big ? 600 : 400} ${fs}px "Microsoft YaHei",sans-serif`;
      ctx.textAlign = "center"; ctx.lineWidth = 3;
      const halo = cssVar("--bg-0", "#16181d");
      ctx.strokeStyle = halo;
      const label = L.extra ? `${t.txt} +${L.extra.length}` : t.txt;
      ctx.strokeText(label, L.x, L.y);
      ctx.fillStyle = t.col; ctx.fillText(label, L.x, L.y);
      ctx.restore();
    });
    /* 命中表 (悬停用) */
    const hits: Hit[] = [];
    for (const b of boxes)
      hits.push({ kind: "box", b, p: project(b.cen), r: 3 * view.current.zoom * 2 });
    for (const r of rows)
      hits.push({ kind: "dot", doc: r, p: project(shift(r.c)), r: 6 });
    hitsRef.current = hits;
  }, [docs, ax, ay, az, cols, alpha, labels, centerStance, stances]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => { if (active) draw(); }, [active, draw]);

  // 容器自适应
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // 交互:拖转 (可反向)/滚轮缩放/悬停命中
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const up = () => { dragRef.current = null; };
    const move = (e: MouseEvent) => {
      const v = view.current;
      if (dragRef.current) {
        const k = (localStorage.getItem("de.cube.invert") !== "0" ? -1 : 1) * 0.008;
        v.yaw += (e.clientX - dragRef.current.x) * k;
        v.pitch = Math.max(-1.4, Math.min(1.4,
          v.pitch + (e.clientY - dragRef.current.y) * k));
        dragRef.current = { x: e.clientX, y: e.clientY };
        drawRef.current(); return;
      }
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let hit: Hit | null = null;
      for (const h of hitsRef.current.slice().reverse()) {
        if (Math.hypot(h.p.x - mx, h.p.y - my) < h.r) { hit = h; break; }
      }
      const prev = hoverRef.current;
      hoverRef.current = hit;
      if (hit) {
        setTip({ x: mx + 14, y: my + 10,
                 text: hit.kind === "box"
                   ? `${hit.b.name} · ${hit.b.n} 篇`
                   : hit.doc.t });
      } else setTip(null);
      if (prev !== hit) drawRef.current();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.zoom = Math.max(0.4, Math.min(4, v.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));   // 0.1.8 V2：上限 3.2→4
      drawRef.current();
    };
    const leave = () => { hoverRef.current = null; setTip(null); };
    cv.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    cv.addEventListener("mousemove", move);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("mouseleave", leave);
    return () => {
      cv.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("mouseleave", leave);
    };
  }, []);

  const setCol = (i: number, v: string) => {
    const next = cols.map((c, k) => (k === i ? v : c));
    setCols(next);
    setUiPref("de.cube.cols", JSON.stringify(next));
  };
  const reset = () => {
    view.current = { yaw: 0.7, pitch: -0.42, zoom: 1 };
    setCols([...DEF_COLS]);
    setUiPref("de.cube.cols", JSON.stringify(DEF_COLS));
  };

  return (
    <div className="viz-view">
      <div className="controls viz-controls">
        <label>X 轴
          <Combobox width={132} value={ax} onChange={setAx}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>Y 轴
          <Combobox width={132} value={ay} onChange={setAy}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>Z 轴
          <Combobox width={132} value={az} onChange={setAz}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label className="cube-col">X 色
          <input type="color" value={cols[0]} onChange={(e) => setCol(0, e.target.value)} /></label>
        <label className="cube-col">Y 色
          <input type="color" value={cols[1]} onChange={(e) => setCol(1, e.target.value)} /></label>
        <label className="cube-col">Z 色
          <input type="color" value={cols[2]} onChange={(e) => setCol(2, e.target.value)} /></label>
        <label className="cube-col">透明度
          <input type="range" min={0} max={90} value={alpha}
                 onChange={(e) => { const v = +e.target.value; setAlpha(v);
                   setUiPref("de.cube.alpha", String(v)); }} />
          <span className="muted small">{alpha}%</span></label>
        <label className="chk">
          <input type="checkbox" checked={invert}
                 onChange={(e) => { setInvert(e.target.checked);
                   setUiPref("de.cube.invert", e.target.checked ? "1" : "0"); }} />
          拖动反向</label>
        <label className="chk">
          <input type="checkbox" checked={labels}
                 onChange={(e) => { setLabels(e.target.checked);
                   setUiPref("de.cube.labels", e.target.checked ? "1" : "0"); }} />
          常显标签</label>
        {/* 项 6:中心立场选择器 */}
        <select value={centerStance} onChange={(e) => setCenterStance(e.target.value)}>
          <option value="">原点 (绝对坐标)</option>
          {stances.map(s => <option key={s.name} value={s.name}>{s.label}</option>)}
        </select>
        {/* 项 7:距离虚线开关 (默认关) */}
        <label className="chk">
          <input type="checkbox" checked={showDistLines}
                 onChange={(e) => setShowDistLines(e.target.checked)} /> 距离虚线</label>
        <button onClick={reset}>复位</button>
      </div>
      {/* 0.1.8 V3：全零引导横幅 */}
      {docs.length > 0 && docs.every((d) => isSuspiciousZero(d.coords)) && (
        <div className="viz-nogl">坐标未提取——到馆藏点「重新提取坐标」后这里才有分布</div>
      )}
      <div ref={hostRef} className="viz-canvas viz-cube">
        <canvas ref={cvRef} className="cube-cv" />
        {tip && (
          <div className="cube-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
        )}
      </div>
    </div>
  );
}
