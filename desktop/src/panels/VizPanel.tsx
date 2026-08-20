// 可视化面板（PLAN-0.1.5 批 5）：图谱区子投影五段滑移（J7）——
// 力导向（原图谱）/ 3D 立方（J1，懒加载分包）/ 坐标散点（J4）/ 立场雷达（J4）/ 交叉分析（J3）。
// coords 数据源三视图共享，进面首次拉取；力导向保持 GraphPanel 原样零改动。
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DocRow } from "../App";
import SegmentedSlider from "../components/SegmentedSlider";
import GraphPanel from "./GraphPanel";
import ScatterView from "../views/viz/ScatterView";
import RadarView from "../views/viz/RadarView";
import CrossTabView from "../views/viz/CrossTabView";
import type { CoordDoc, StanceProfile } from "../lib/axes";

const CubeView = lazy(() => import("../views/viz/CubeView"));

interface Props {
  stances: { name: string; label: string }[];
  docs: DocRow[];
  notify: (msg: string) => void;
  active: boolean;
  onChain?: (anchor: string) => void;
  onShowDoc?: (doc: DocRow) => void;
}

const MODES = [
  { key: "force", label: "力导向" },
  { key: "cube", label: "3D 立方" },
  { key: "scatter", label: "坐标散点" },
  { key: "radar", label: "立场雷达" },
  { key: "cross", label: "交叉分析" },
];

export default function VizPanel({ stances, docs, notify, active,
                                   onChain, onShowDoc }: Props) {
  const [mode, setMode] = useState("force");
  const [coordDocs, setCoordDocs] = useState<CoordDoc[] | null>(null);
  const [profiles, setProfiles] = useState<StanceProfile[]>([]);

  const stanceLabel = useCallback((name: string) =>
    stances.find((s) => s.name === name)?.label || name, [stances]);

  // coords 懒拉取：首次切到坐标类视图才取；docs 变化（入库/删除）失效重取
  useEffect(() => {
    if (!active || mode === "force" || mode === "cross") return;
    if (coordDocs !== null) return;
    api.get<{ docs: CoordDoc[]; profiles: StanceProfile[] }>("/api/analysis/coords")
      .then((r) => { setCoordDocs(r.docs); setProfiles(r.profiles); })
      .catch((e) => notify(`坐标数据加载失败: ${e}`));
  }, [active, mode, coordDocs, notify]);
  useEffect(() => { setCoordDocs(null); }, [docs.length]);

  const scatter = <ScatterView docs={coordDocs ?? []} />;

  return (
    <div className="panel viz-panel" style={{ padding: 0, gap: 0 }}>
      <div className="seg-row viz-seg">
        <SegmentedSlider value={mode} onChange={setMode} options={MODES} />
      </div>
      {/* 力导向 always-mount 保引擎状态（I1 同款）；坐标类视图轻量，按需挂载 */}
      <div style={{ display: mode === "force" ? "contents" : "none" }}>
        <GraphPanel stances={stances} docs={docs} notify={notify}
                    active={active && mode === "force"}
                    onChain={onChain} onShowDoc={onShowDoc} />
      </div>
      {mode === "cube" && (
        <Suspense fallback={<div className="empty-state"><p>3D 引擎加载中…</p></div>}>
          <CubeView docs={coordDocs ?? []} active={active} fallback={scatter} />
        </Suspense>
      )}
      {mode === "scatter" && scatter}
      {mode === "radar" && (
        <RadarView profiles={profiles} stanceLabel={stanceLabel} />
      )}
      {mode === "cross" && (
        <CrossTabView docs={docs} stanceLabel={stanceLabel} notify={notify}
                      active={active && mode === "cross"} />
      )}
    </div>
  );
}
