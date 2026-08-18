// 对比面板（项目15）：跨页对比（库内两文档 / 粘贴两段文本）+ 内部分歧地图
import { useState } from "react";
import { api } from "../api";
import type { DocRow } from "../App";

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
}

const REL_LABEL: Record<string, string> = {
  support: "支持", attack: "对立", refine: "细化",
  similar: "论题相近", unrelated: "无关",
};

export default function ComparePanel({ stances, docs, compareList, notify }: Props) {
  const [mode, setMode] = useState<"docs" | "texts" | "divergence">("docs");
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
      <div className="controls">
        <label>模式
          <select value={mode} onChange={(e) => { setMode(e.target.value as never); setRows(null); }}>
            <option value="docs">库内两文档对比</option>
            <option value="texts">粘贴两段文本对比</option>
            <option value="divergence">同立场内部分歧地图</option>
          </select>
        </label>
        {mode === "docs" && (
          <>
            <label>甲方文档
              <select value={docA} onChange={(e) => setDocA(e.target.value)}>
                <option value="">（选择）</option>
                {docs.map((d) => <option key={d.doc_id} value={d.doc_id}>{d.title || d.doc_id}</option>)}
              </select>
            </label>
            <label>乙方文档
              <select value={docB} onChange={(e) => setDocB(e.target.value)}>
                <option value="">（选择）</option>
                {docs.map((d) => <option key={d.doc_id} value={d.doc_id}>{d.title || d.doc_id}</option>)}
              </select>
            </label>
          </>
        )}
        {mode === "divergence" && (
          <label>立场
            <select value={stance} onChange={(e) => setStance(e.target.value)}>
              {stances.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
            </select>
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
