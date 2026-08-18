// 搜索面板（项目12，按架构 §十七）：立场/模式/中心点参数 + 命中高亮 +
// 结果卡片（文档→段落粒度）+「查看原文」推送右栏
import { useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { DocRow } from "../App";

interface Chunk {
  chunk_id: string;
  doc_id: string;
  score: number;
  text: string;
}

interface SearchResp {
  query: string;
  context_relevance: number;
  chunks: Chunk[];
  excluded_docs: string[];
  retrieval_ms: number;
}

interface Props {
  stances: { name: string; label?: string }[];
  docs: DocRow[];
  setSide: (v: { title: string; body: ReactNode } | null) => void;
  setRightOpen: (v: boolean) => void;
  notify: (msg: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  keyword: "关键词", semantic: "语义", hybrid: "混合", smart: "智能",
};

/** 命中高亮：按查询词简单分词后标记 */
function highlight(text: string, q: string): ReactNode {
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  // split 带捕获组：奇数位置即命中词（避免 /g 正则 lastIndex 状态坑）
  return text.split(re).map((seg, i) =>
    i % 2 === 1 ? <mark key={i}>{seg}</mark> : seg);
}

export default function SearchPanel({ stances, docs, setSide, setRightOpen, notify }: Props) {
  const [q, setQ] = useState("");
  const [stance, setStance] = useState("empirical");
  const [mode, setMode] = useState("hybrid");
  const [topK, setTopK] = useState(5);
  const [running, setRunning] = useState(false);
  const [resp, setResp] = useState<SearchResp | null>(null);

  const docTitle = (id: string) =>
    docs.find((d) => d.doc_id === id)?.title || id;

  const run = async () => {
    if (!q.trim() || running) return;
    setRunning(true);
    try {
      const r = await api.get<SearchResp>(
        `/api/knowledge/search?q=${encodeURIComponent(q.trim())}` +
        `&stance=${stance}&mode=${mode}&top_k=${topK}`);
      setResp(r);
    } catch (e) {
      notify(`搜索失败: ${e}`);
    } finally {
      setRunning(false);
    }
  };

  const viewSource = async (c: Chunk) => {
    setRightOpen(true);
    setSide({ title: docTitle(c.doc_id), body: <div className="muted">加载原文…</div> });
    try {
      const r = await api.get<{ markdown: string }>(
        `/api/knowledge/docs/${c.doc_id}/preview`);
      setSide({
        title: docTitle(c.doc_id),
        body: <pre className="md-preview">{r.markdown}</pre>,
      });
    } catch (e) {
      setSide({ title: docTitle(c.doc_id), body: <div className="err">{String(e)}</div> });
    }
  };

  return (
    <div className="panel search">
      <div className="controls">
        <input className="search-input" value={q} placeholder="搜索知识库…"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && run()} />
        <label>立场
          <select value={stance} onChange={(e) => setStance(e.target.value)}>
            {stances.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
          </select>
        </label>
        <label>模式
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>条数
          <input className="len" type="number" min={1} max={20} value={topK}
                 onChange={(e) => setTopK(Number(e.target.value) || 5)} />
        </label>
        <button className="primary" onClick={run} disabled={running || !q.trim()}>
          {running ? "搜索中…" : "搜索"}
        </button>
      </div>

      {resp && (
        <>
          <div className="muted small pad-h">
            相关性 {resp.context_relevance.toFixed(3)} · 耗时 {resp.retrieval_ms}ms
            {resp.excluded_docs.length > 0 && ` · 已排除对立文档 ${resp.excluded_docs.length} 篇`}
          </div>
          <div className="result-list">
            {resp.chunks.length === 0 && <div className="muted pad">没有命中，试试换模式或立场</div>}
            {resp.chunks.map((c) => (
              <div key={c.chunk_id} className="result-card">
                <div className="result-head">
                  <b>{docTitle(c.doc_id)}</b>
                  <span className="muted small">{c.chunk_id} · {c.score.toFixed(4)}</span>
                </div>
                <p>{highlight(c.text, resp.query)}</p>
                <div className="result-actions">
                  <button className="link" onClick={() => viewSource(c)}>查看原文</button>
                  <button className="link" onClick={() => {
                    navigator.clipboard?.writeText(c.text);
                    notify("段落已复制，可粘贴到反驳论点或其他工具");
                  }}>用作反驳来源</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
