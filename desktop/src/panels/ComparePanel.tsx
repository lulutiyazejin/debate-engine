// 对比面板（项目15）：跨页对比（库内两文档 / 粘贴两段文本）+ 内部分歧地图
import { useState } from "react";
import { api } from "../api";
import type { DocRow } from "../App";
import Combobox from "../components/Combobox";
import SegmentedSlider from "../components/SegmentedSlider";

interface Row {
  a_claim: string; a_doc: string; a_thinker?: string;
  b_claim: string; b_doc: string; b_thinker?: string;
  similarity: number; relation: string; note: string; judged_by?: string;
}

interface Props {
  stances: { name: string; label: string }[];
  docs: DocRow[];
  compareList: DocRow[];
  notify: (msg: string) => void;
  initialMode?: "docs" | "texts" | "divergence";
  onShowDoc?: (doc: DocRow) => void;   // 批 2/23：选中项旁「查看」开右栏
}

const REL_LABEL: Record<string, string> = {
  support: "支持", attack: "对立", refine: "细化",
  evolve: "演进", analogy: "类比", oppose: "同题对立",
  similar: "论题相近", unrelated: "无关",
};

export default function ComparePanel({ stances, docs, compareList, notify,
                                        initialMode, onShowDoc }: Props) {
  const [mode, setMode] = useState<"docs" | "texts" | "divergence">(
    initialMode || "docs");
  const [docA, setDocA] = useState("");
  const [docB, setDocB] = useState("");
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [stance, setStance] = useState("");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState("");

  const docTitle = (id: string) => docs.find((d) => d.doc_id === id)?.title || id;

  const run = async () => {
    setRunning(true);
    setRows(null);
    try {
      if (mode === "divergence") {
        const st = stance || stances[0]?.name;
        const r = await api.get<{ unit_count: number; divergences: Row[] }>(
          `/api/analysis/divergence?stance=${st}`);
        setRows(r.divergences);
        setMeta(`立场内共 ${r.unit_count} 条论证单元，发现 ${r.divergences.length} 组分歧`);
      } else {
        const body = mode === "docs"
          ? { doc_a: docA, doc_b: docB }
          : { text_a: textA, text_b: textB };
        const r = await api.post<{ rows: Row[]; units_a: number; units_b: number }>(
          "/api/analysis/compare", body);
        setRows(r.rows);
        setMeta(`甲方 ${r.units_a} 条单元 × 乙方 ${r.units_b} 条单元，配对 ${r.rows.length} 组`);
      }
    } catch (e) {
      notify(`分析失败: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  const canRun = mode === "docs" ? (docA && docB && docA !== docB)
    : mode === "texts" ? (textA.trim() && textB.trim())
    : true;

  return (
    <div className="panel compare">
      {/* 0.1.5 J7：对比子 tab 改滑移分段器 */}
      <div className="seg-row" style={{ padding: 0 }}>
        <SegmentedSlider value={mode}
          onChange={(k) => { setMode(k as typeof mode); setRows(null); }}
          options={[
            { key: "docs", label: "库内两文档对比" },
            { key: "texts", label: "粘贴两段文本对比" },
            { key: "divergence", label: "同立场内部分歧地图" },
          ]} />
      </div>
      <div className="controls">
        {mode === "docs" && (
          <>
            <label>甲方文档
              <Combobox width={230} value={docA} onChange={setDocA}
                        placeholder="（选择）" scopeLabel="馆藏标题/作者"
                        onView={onShowDoc ? (v) => {
                          const d = docs.find((x) => x.doc_id === v);
                          if (d) onShowDoc(d);
                        } : undefined}
                        options={docs.map((d) => ({ value: d.doc_id,
                          label: d.title || d.doc_id,
                          sub: (d.author as string) || undefined }))} />
            </label>
            <label>乙方文档
              <Combobox width={230} value={docB} onChange={setDocB}
                        placeholder="（选择）" scopeLabel="馆藏标题/作者"
                        onView={onShowDoc ? (v) => {
                          const d = docs.find((x) => x.doc_id === v);
                          if (d) onShowDoc(d);
                        } : undefined}
                        options={docs.map((d) => ({ value: d.doc_id,
                          label: d.title || d.doc_id,
                          sub: (d.author as string) || undefined }))} />
            </label>
          </>
        )}
        {mode === "divergence" && (
          <label>立场
            <Combobox width={180} value={stance || stances[0]?.name || ""}
                      onChange={setStance} scopeLabel="立场名"
                      options={stances.map((s) => ({ value: s.name, label: s.label }))} />
          </label>
        )}
        <button className="primary" onClick={run} disabled={running || !canRun}>
          {running ? "对齐配对中…" : "开始分析"}
        </button>
      </div>

      {mode === "docs" && compareList.length >= 2 && !docA && (
        <div className="muted small pad-h">
          提示：右键菜单已收集 {compareList.length} 篇——
          <button className="link" onClick={() => {
            setDocA(compareList[0].doc_id);
            setDocB(compareList[1].doc_id);
          }}>填入前两篇</button>
        </div>
      )}

      {mode === "texts" && (
        <div className="controls" style={{ alignItems: "stretch" }}>
          <textarea className="arg-input" style={{ flex: 1 }} rows={5}
                    placeholder="甲方文本…" value={textA}
                    onChange={(e) => setTextA(e.target.value)} />
          <textarea className="arg-input" style={{ flex: 1 }} rows={5}
                    placeholder="乙方文本…" value={textB}
                    onChange={(e) => setTextB(e.target.value)} />
        </div>
      )}

      {rows && (
        <>
          <div className="muted small pad-h">{meta}</div>
          {rows.length === 0 && <div className="muted pad">没有发现论题相近的论点配对</div>}
          <div className="result-list">
            {rows.map((r, i) => (
              <div key={i} className="result-card">
                <div className="result-head">
                  <span className={"badge " + (r.relation === "attack" ? "warn" : r.relation === "support" ? "ok" : "")}>
                    {REL_LABEL[r.relation] || r.relation}
                  </span>
                  <span className="muted small">相似度 {r.similarity} · {r.note}</span>
                </div>
                <p><b>甲</b>（{r.a_thinker || docTitle(r.a_doc)}）：{r.a_claim}</p>
                <p><b>乙</b>（{r.b_thinker || docTitle(r.b_doc)}）：{r.b_claim}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
