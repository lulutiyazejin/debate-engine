// J3 交叉透视（PLAN-0.1.5 批 5）：行=立场 × 列=轴区间分箱 × 值=论证单元数/平均坐标，
// 自绘表（决策 10 底子，S2 评估通过前不引包）；子切换含 J4 热力（章节×轴密度，次选）。
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import Combobox from "../../components/Combobox";
import SegmentedSlider from "../../components/SegmentedSlider";
import { AXES, axisLabel, axisOptions, coordColor } from "../../lib/axes";
import type { DocRow } from "../../App";

interface XTab { bins: string[]; rows: { stance: string; cells: (number | null)[]; total: number }[] }
interface Heat { axes: string[]; chapters: string[]; grid: (number | null)[][] }

interface Props {
  docs: DocRow[];
  stanceLabel: (name: string) => string;
  notify: (msg: string) => void;
  active: boolean;
}

export default function CrossTabView({ docs, stanceLabel, notify, active }: Props) {
  const [mode, setMode] = useState("xtab");            // xtab | heat
  const [axis, setAxis] = useState("ownership");
  const [metric, setMetric] = useState("count");       // count | avg
  const [metricAxis, setMetricAxis] = useState("political_authority");
  const [xtab, setXtab] = useState<XTab | null>(null);
  const [heatDoc, setHeatDoc] = useState("");
  const [heat, setHeat] = useState<Heat | null>(null);
  // 0.1.8 V4：等宽数字开关（0.1.7 项 10 欠账）
  const [mono, setMono] = useState(localStorage.getItem("de.viz.mono") !== "0");

  const loadXtab = useCallback(async () => {
    try {
      const q = new URLSearchParams({ axis, metric });
      if (metric === "avg") q.set("metric_axis", metricAxis);
      setXtab(await api.get<XTab>(`/api/analysis/crosstab?${q}`));
    } catch (e) { notify(`交叉透视加载失败: ${e}`); }
  }, [axis, metric, metricAxis, notify]);

  useEffect(() => { if (active && mode === "xtab") loadXtab(); },
    [active, mode, loadXtab]);

  useEffect(() => {
    if (!active || mode !== "heat" || !heatDoc) return;
    api.get<Heat>(`/api/analysis/heatmap?doc_id=${encodeURIComponent(heatDoc)}`)
      .then(setHeat).catch((e) => notify(`热力加载失败: ${e}`));
  }, [active, mode, heatDoc, notify]);

  // 数值 → 单元格底色：计数走强度（相对本表最大值），均值走恒定红蓝色标
  const maxCount = Math.max(1, ...(xtab?.rows ?? []).flatMap(
    (r) => r.cells.map((c) => (typeof c === "number" ? c : 0))));
  const cellBg = (v: number | null): string => {
    if (v === null || v === undefined) return "transparent";
    if (metric === "avg") return coordColor(v) + "44";
    return `color-mix(in oklab, var(--accent) ${Math.round((v / maxCount) * 42)}%, transparent)`;
  };

  return (
    <div className="viz-view">
      <div className="controls viz-controls">
        <SegmentedSlider value={mode} onChange={setMode}
          options={[{ key: "xtab", label: "立场交叉" }, { key: "heat", label: "章节热力" }]} />
        {mode === "xtab" ? (
          <>
            <label>分箱轴
              <Combobox width={150} value={axis} onChange={setAxis}
                        scopeLabel="轴名" options={axisOptions} />
            </label>
            <SegmentedSlider value={metric} onChange={setMetric}
              options={[{ key: "count", label: "单元数" }, { key: "avg", label: "平均坐标" }]} />
            {metric === "avg" && (
              <label>取值轴
                <Combobox width={150} value={metricAxis} onChange={setMetricAxis}
                          scopeLabel="轴名" options={axisOptions} />
              </label>
            )}
          </>
        ) : (
          <label>文档
            <Combobox width={260} value={heatDoc} onChange={setHeatDoc}
                      placeholder="选择文档" scopeLabel="馆藏标题/作者"
                      options={docs.map((d) => ({ value: d.doc_id,
                        label: d.title || d.doc_id,
                        sub: (d.author as string) || undefined }))} />
          </label>
        )}
        <label className="chk">
          <input type="checkbox" checked={mono}
                 onChange={(e) => { setMono(e.target.checked);
                   localStorage.setItem("de.viz.mono", e.target.checked ? "1" : "0"); }} />
          等宽数字</label>
      </div>
      {/* 0.1.8 V4：每图旁注一行（数据来源+口径） */}
      <div className="muted small viz-note">
        {mode === "xtab"
          ? `数据来源：论证单元坐标按立场 × ${axisLabel(axis)} 区间聚合 · 口径：${
              metric === "avg" ? "平均坐标（真值 -5..+5）" : "单元计数"}`
          : "数据来源：单文档章节 × 轴 坐标强度均值 · 口径 0-5"}
      </div>
      <div className="viz-canvas" style={{ overflow: "auto", alignItems: "flex-start" }}>
        {mode === "xtab" && (
          !xtab || xtab.rows.length === 0
            ? <div className="empty-state"><p>暂无交叉数据</p>
                <p className="muted small">论证单元带坐标后，可按立场 × 轴区间聚合透视。</p></div>
            : <table className={"xtab-table" + (mono ? " mono-nums" : "")}>
                <thead>
                  <tr>
                    <th>{`立场 ＼ ${axisLabel(axis)}`}</th>
                    {xtab.bins.map((b) => <th key={b}>{b}</th>)}
                    <th>合计</th>
                  </tr>
                </thead>
                <tbody>
                  {xtab.rows.map((r) => (
                    <tr key={r.stance}>
                      <td className="xtab-head">{stanceLabel(r.stance) || "未分类"}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} style={{ background: cellBg(c) }}>
                          {c === null ? "—" : c}</td>
                      ))}
                      <td className="xtab-total">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
        )}
        {mode === "heat" && (
          !heatDoc
            ? <div className="empty-state"><p>选择一篇文档</p>
                <p className="muted small">按「章节 × 轴」呈现论证密度（坐标强度均值）。</p></div>
            : !heat || heat.chapters.length === 0
              ? <div className="empty-state"><p>该文档暂无章节/单元坐标</p></div>
              : <table className={"xtab-table heat-table" + (mono ? " mono-nums" : "")}>
                  <thead>
                    <tr>
                      <th>章节 ＼ 轴</th>
                      {heat.axes.map((a) => <th key={a} title={a}>{
                        AXES.find((x) => x.key === a)?.label ?? a}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {heat.chapters.map((ch, ri) => (
                      <tr key={ri}>
                        <td className="xtab-head" title={ch}>{ch}</td>
                        {heat.grid[ri].map((v, ci) => (
                          <td key={ci} style={{ background: v === null ? "transparent"
                            : `color-mix(in oklab, var(--accent) ${Math.round((v / 5) * 55)}%, transparent)` }}>
                            {v === null ? "" : v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
        )}
      </div>
    </div>
  );
}
