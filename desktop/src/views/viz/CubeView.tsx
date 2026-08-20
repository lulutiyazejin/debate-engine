// J1 3D 立方体（PLAN-0.1.5 批 5）：G2 point3D 动态 import（包体积隔离，D6 分包），
// X/Y/Z 三 Combobox 任选 22 轴；着色轴默认政治轴，左红→中灰→右蓝恒定色标（决策 13 延伸）；
// 交互拖转/缩放（ControlPlugin ORBITING 相机）；无 WebGL → 提示 + J4 散点兜底。
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Combobox from "../../components/Combobox";
import { axisLabel, axisOptions, COLOR_MID, COLOR_NEG, COLOR_POS } from "../../lib/axes";
import type { CoordDoc } from "../../lib/axes";

interface Props {
  docs: CoordDoc[];
  active: boolean;
  fallback: ReactNode;   // 无 WebGL 时的 J4 散点视图（VizPanel 注入，避免环形依赖）
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

export default function CubeView({ docs, active, fallback }: Props) {
  const [ax, setAx] = useState("ownership");
  const [ay, setAy] = useState("political_authority");
  const [az, setAz] = useState("imperialism");
  const [ac, setAc] = useState("political_authority");
  const [status, setStatus] = useState<"boot" | "ready" | "nogl">("boot");
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!hasWebGL()) { setStatus("nogl"); return; }
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    (async () => {
      try {
        // 动态 import：G2 内核 + 3D 扩展 + WebGL 渲染器 + 3D/相机控制插件（自成 chunk）
        const [g2, ext3d, webgl, p3d, pctl, g] = await Promise.all([
          import("@antv/g2"), import("@antv/g2-extension-3d"),
          import("@antv/g-webgl"), import("@antv/g-plugin-3d"),
          import("@antv/g-plugin-control"), import("@antv/g"),
        ]);
        if (disposed) return;
        const renderer = new webgl.Renderer();
        renderer.registerPlugin(new p3d.Plugin());
        renderer.registerPlugin(new pctl.Plugin());
        const Chart = g2.extend(g2.Runtime, { ...g2.corelib(), ...ext3d.threedlib() });
        const w = Math.max(320, host.clientWidth);
        const h = Math.max(280, host.clientHeight);
        const depth = Math.min(w, h) * 0.8;
        host.replaceChildren();
        const chart = new Chart({ container: host, renderer,
                                  width: w, height: h, depth });
        const rows = docs
          .filter((d) => ax in d.coords && ay in d.coords && az in d.coords)
          .map((d) => ({ x: d.coords[ax], y: d.coords[ay], z: d.coords[az],
                         c: d.coords[ac] ?? 0,
                         title: `${d.title}${d.author ? " · " + d.author : ""}` }));
        chart.point3D()
          .data(rows)
          .encode("x", "x").encode("y", "y").encode("z", "z")
          .encode("color", "c").encode("shape", "sphere").encode("size", 3)
          .coordinate({ type: "cartesian3D" })
          .scale("x", { domain: [-5, 5] })
          .scale("y", { domain: [-5, 5] })
          .scale("z", { domain: [-5, 5] })
          .scale("color", { type: "linear", domain: [-5, 0, 5],
                            range: [COLOR_NEG, COLOR_MID, COLOR_POS] })
          .legend(false)
          .axis("x", { gridLineWidth: 1, title: axisLabel(ax) })
          .axis("y", { gridLineWidth: 1, title: axisLabel(ay),
                       titleBillboardRotation: -Math.PI / 2 })
          .axis("z", { gridLineWidth: 1, title: axisLabel(az) })
          .style("opacity", 0.9)
          .tooltip({ title: "title" });
        await chart.render();
        if (disposed) { chart.destroy(); return; }
        // ORBITING 相机：拖转/缩放全交互（ControlPlugin 托管）
        const { canvas } = chart.getContext();
        const camera = canvas!.getCamera();
        camera.setPerspective(0.1, 5000, 45, w / h);
        camera.setType(g.CameraType.ORBITING);
        chartRef.current = chart;
        setStatus("ready");
      } catch (e) {
        console.warn("3D 立方初始化失败，回落散点视图", e);
        if (!disposed) setStatus("nogl");
      }
    })();
    return () => {
      disposed = true;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [active, docs, ax, ay, az, ac]);

  if (status === "nogl") {
    return (
      <div className="viz-view">
        <div className="viz-nogl">当前环境不支持 WebGL（或 3D 初始化失败），已回落坐标散点视图。</div>
        {fallback}
      </div>
    );
  }

  return (
    <div className="viz-view">
      <div className="controls viz-controls">
        <label>X 轴
          <Combobox width={140} value={ax} onChange={setAx}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>Y 轴
          <Combobox width={140} value={ay} onChange={setAy}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>Z 轴
          <Combobox width={140} value={az} onChange={setAz}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <label>着色轴
          <Combobox width={140} value={ac} onChange={setAc}
                    scopeLabel="轴名" options={axisOptions} />
        </label>
        <span className="muted small">
          {status === "boot" ? "3D 引擎加载中…" : "拖转 / 滚轮缩放"}
        </span>
      </div>
      <div ref={hostRef} className="viz-canvas viz-cube" />
    </div>
  );
}
