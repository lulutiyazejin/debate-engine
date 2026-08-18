// 报告面板（项目17）：跨立场综合报告（token 预估 → 生成 → Markdown 导出）
// + 论点溯源（库内=有据，模型推测异色区分）
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";

interface Props {
  stances: { name: string; label: string }[];
  notify: (msg: string) => void;
}

interface TraceRow {
  claim: string; thinker?: string; school?: string; doc_title?: string;
  year?: number; similarity: number; evidence_level: string;
}

export function ReportPanel({ stances, notify }: Props) {
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<{ token_estimate: number; llm_calls: number; stances: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{ report_markdown: string; provider: string } | null>(null);

  const toggle = (name: string) =>
    setPicked((p) => p.includes(name) ? p.filter((x) => x !== name) : [...p, name]);

  const doEstimate = async () => {
    try {
      const r = await api.post<typeof estimate>("/api/analysis/report/estimate",
        { topic: topic.trim(), stances: picked.length ? picked : null });
      setEstimate(r);
    } catch (e) {
      notify(`预估失败: ${e}`);
    }
  };

  const doGenerate = async () => {
    setRunning(true);
    setReport(null);
    try {
      const r = await api.post<{ report_markdown: string; provider: string }>(
        "/api/analysis/report",
        { topic: topic.trim(), stances: picked.length ? picked : null });
      setReport(r);
    } catch (e) {
      notify(`生成失败: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  const exportMd = async () => {
    if (!report) return;
    const path = await save({
      title: "导出报告", defaultPath: "综合报告.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      const r = await api.post<{ path: string }>("/api/kb/save-text",
        { path, content: report.report_markdown });
      notify(`已导出：${r.path}`);
    } catch (e) {
      notify(`导出失败: ${e}`);
    }
  };

  return (
    <div className="panel report">
      <div className="controls">
        <input className="search-input" value={topic}
               placeholder="输入论题，例如：全民基本收入是否可行"
               onChange={(e) => { setTopic(e.target.value); setEstimate(null); }}
               onKeyDown={(e) => e.key === "Enter" && topic.trim() && doEstimate()} />
        <button className="primary" onClick={doEstimate} disabled={!topic.trim() || running}>
          预估消耗
        </button>
      </div>
      <div className="controls">
        <span className="muted small">参与立场（不选=全部有文档的立场）：</span>
        {stances.map((s) => (
          <label key={s.name} className="chk">
            <input type="checkbox" checked={picked.includes(s.name)}
                   onChange={() => toggle(s.name)} /> {s.label}
          </label>
        ))}
      </div>
      {estimate && (
        <div className="demo-warn" style={{ borderColor: "var(--accent)", color: "var(--fg)", background: "rgba(79,140,255,0.08)" }}>
          将检索 {estimate.stances.length} 个立场，约 {estimate.llm_calls} 次模型调用、
          {estimate.token_estimate} tokens。
          <button className="link" onClick={doGenerate} disabled={running}>
            {running ? "生成中（可能需要一两分钟）…" : "确认生成"}
          </button>
        </div>
      )}
      {report && (
        <>
          <div className="controls">
            <span className="muted small">模型：{report.provider}</span>
            <button onClick={exportMd}>导出 Markdown…</button>
          </div>
          <div className="output"><pre className="md-preview">{report.report_markdown}</pre></div>
        </>
      )}
    </div>
  );
}

export function TracePanel({ notify }: { notify: (msg: string) => void }) {
  const [claim, setClaim] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ chain: TraceRow[]; speculation: string; speculation_level: string } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await api.post<typeof result>("/api/analysis/trace",
        { claim: claim.trim() });
      setResult(r);
    } catch (e) {
      notify(`溯源失败: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="panel trace">
      <div className="controls">
        <input className="search-input" value={claim}
               placeholder="输入论点，追踪其思想史渊源，例如：私有制是一切不平等的根源"
               onChange={(e) => setClaim(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && claim.trim() && run()} />
        <button className="primary" onClick={run} disabled={!claim.trim() || running}>
          {running ? "对齐追踪中…" : "开始溯源"}
        </button>
      </div>
      {result && (
        <>
          {result.chain.length === 0 &&
            <div className="muted pad">库内没有找到相近论点——先导入相关文献</div>}
          <div className="result-list">
            {result.chain.map((r, i) => (
              <div key={i} className="result-card">
                <div className="result-head">
                  <b>{r.year || "年代不详"} · {r.thinker || "佚名"}{r.school ? `（${r.school}）` : ""}</b>
                  <span className="badge ok">库内有据 · 相似 {r.similarity}</span>
                </div>
                <p>{r.claim}</p>
                <div className="muted small">出处：{r.doc_title}</div>
              </div>
            ))}
          </div>
          {result.speculation && (
            <div className="demo-warn">
              ⚠ {result.speculation_level}：{result.speculation}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ReportPanel;
