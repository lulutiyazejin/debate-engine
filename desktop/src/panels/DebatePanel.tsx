// 0.1.8 N1：双立场自动对辩——议题 + 两立场轮流互驳（S3 BgTask NDJSON 断线自动重连）。
// 输出双栏左右对排（左 a 右 b），完成后可一键存为回应历史（intent="debate"）。
import { useRef, useState } from "react";
import { api } from "../api";
import { ndjsonPostResume } from "../lib/ndjson";
import type { StanceOpt } from "../App";

interface Turn { round: number; side: "a" | "b"; stance: string; text: string }

interface Props {
  stances: StanceOpt[];
  notify: (msg: string) => void;
  onSaved: () => void;   // 存历史后刷新左栏
}

export default function DebatePanel({ stances, notify, onSaved }: Props) {
  const [topic, setTopic] = useState("");
  const [sa, setSa] = useState("");
  const [sb, setSb] = useState("");
  const [rounds, setRounds] = useState(3);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // R3 联动：无立场（none）不可选为对辩方
  const opts = stances.filter((s) => s.name !== "none");
  const label = (n: string) => opts.find((s) => s.name === n)?.label || n || "—";

  const start = async () => {
    if (topic.trim().length < 2) { notify("先输入对辩议题"); return; }
    if (!sa || !sb) { notify("选择对辩双方立场"); return; }
    if (sa === sb) { notify("双方立场不能相同"); return; }
    setTurns([]); setDone(false); setRunning(true); setStatus("开始对辩…");
    abortRef.current = new AbortController();
    try {
      await ndjsonPostResume("/api/debate",
        { topic: topic.trim(), stance_a: sa, stance_b: sb, rounds },
        (evt) => {
          if (typeof evt.status === "string") setStatus(String(evt.status));
          if (evt.text && evt.side) {
            setTurns((prev) => [...prev, {
              round: Number(evt.round), side: evt.side as "a" | "b",
              stance: String(evt.stance), text: String(evt.text) }]);
          }
          if (evt.done) {
            setDone(Boolean(evt.ok));
            setStatus(String(evt.detail || "对辩结束"));
          }
        }, abortRef.current.signal);
    } catch (e) {
      setStatus(`对辩中断: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  const cancel = async () => {
    abortRef.current?.abort();
    await api.post("/api/debate/cancel", {}).catch(() => {});
    setRunning(false); setStatus("已取消");
  };

  // 完成后存为回应历史（intent="debate"）
  const save = async () => {
    const out = turns.map((t) =>
      `【第 ${t.round} 轮 · ${t.side === "a" ? "正方" : "反方"} · ${label(t.stance)}】\n${t.text}`)
      .join("\n\n");
    try {
      await api.post("/api/responses", {
        intent: "debate", stance: `${sa} vs ${sb}`,
        input_text: `对辩议题：${topic.trim()}`, output_text: out });
      notify("已存为回应历史");
      onSaved();
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  return (
    <div className="debate-panel">
      <div className="controls pad-h">
        <input className="search-input" value={topic} disabled={running}
               placeholder="对辩议题：如「市场经济是否需要强监管」（双方将轮流互驳）"
               onChange={(e) => setTopic(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && !running && start()} />
      </div>
      <div className="controls pad-h">
        <label>正方
          <select value={sa} disabled={running} onChange={(e) => setSa(e.target.value)}>
            <option value="">选择立场</option>
            {opts.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
          </select>
        </label>
        <label>反方
          <select value={sb} disabled={running} onChange={(e) => setSb(e.target.value)}>
            <option value="">选择立场</option>
            {opts.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
          </select>
        </label>
        <label>轮数
          <select value={rounds} disabled={running}
                  onChange={(e) => setRounds(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} 轮</option>)}
          </select>
        </label>
        {!running
          ? <button className="primary" onClick={start}>开始对辩</button>
          : <button onClick={cancel}>停止</button>}
        {done && turns.length > 0 && (
          <button className="link" onClick={save}>存为回应历史</button>)}
      </div>
      {status && (
        <div className="muted small pad-h" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {running && <div className="spinner sm" />}{status}
        </div>
      )}
      {turns.length === 0 && !running && (
        <div className="empty-state">
          <p>选定议题与两个立场，模型将轮流以对方上轮输出为靶子互驳</p>
          <p className="muted small">中途断线不中断——任务在本地引擎后台继续，回来自动续看。</p>
        </div>
      )}
      {turns.length > 0 && (
        <div className="debate-grid">
          <div className="debate-colhead">正方 · {label(sa)}</div>
          <div className="debate-colhead">反方 · {label(sb)}</div>
          {turns.map((t, i) => (
            <div key={i} className={`debate-card ${t.side}`}
                 style={{ gridColumn: t.side === "a" ? 1 : 2 }}>
              <div className="muted small">第 {t.round} 轮 · {label(t.stance)}</div>
              <pre className="md-preview">{t.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
