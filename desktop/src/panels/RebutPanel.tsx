// 反驳输出面板（项目12）：论点输入 + 立场/格式/风格/字数/引用格式/检索模式/中心点
// 选择器 + SSE 流式输出 + 谬误疑似标注 + 引用推送右栏
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, rebutStream } from "../api";

interface Options {
  formats: Record<string, string>;
  styles: Record<string, { label: string; demo_warning: boolean }>;
  cite_formats: string[];
  modes: string[];
  max_length: number;
}

interface Props {
  stances: { name: string; label?: string }[];
  prefill: { stance?: string; argument?: string };
  setSide: (v: { title: string; body: ReactNode } | null) => void;
  setRightOpen: (v: boolean) => void;
  notify: (msg: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  keyword: "关键词", semantic: "语义", hybrid: "混合", smart: "智能",
};

export default function RebutPanel({ stances, prefill, setSide, setRightOpen, notify }: Props) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [centers, setCenters] = useState<{ key: string; label: string }[]>([]);
  const [argument, setArgument] = useState("");
  const [stance, setStance] = useState("");
  const [format, setFormat] = useState("argument");
  const [style, setStyle] = useState("rebuttal");
  const [length, setLength] = useState("");
  const [citeFmt, setCiteFmt] = useState("plain");
  const [mode, setMode] = useState("hybrid");
  const [center, setCenter] = useState("");
  const [fallacy, setFallacy] = useState(true);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [meta, setMeta] = useState<{ provider?: string; fallacies?: { name: string; quote: string; reason: string }[] }>({});
  const abortRef = useRef<AbortController | null>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Options>("/api/rebuttal/options").then(setOpts)
      .catch((e) => notify(`读取选项失败: ${e}`));
    api.get<{ centers: { key: string; label: string }[] }>("/api/knowledge/centers")
      .then((r) => setCenters(r.centers)).catch(() => setCenters([]));
  }, [notify]);

  useEffect(() => {
    if (prefill.stance) setStance(prefill.stance);
    if (prefill.argument) setArgument(prefill.argument);
  }, [prefill]);

  useEffect(() => {
    if (!stance && stances.length) setStance(stances[0].name);
  }, [stances, stance]);

  // 流式输出时自动滚底
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [output]);

  const run = async () => {
    if (!argument.trim() || running) return;
    setRunning(true);
    setOutput("");
    setMeta({});
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await rebutStream({
        argument: argument.trim(), stance, format, style,
        length: length ? Number(length) : null,
        cite_format: citeFmt, fallacy, mode,
        center: center || null, stream: true,
      }, (evt) => {
        if (evt.event === "meta") {
          setMeta({
            provider: evt.data.provider as string,
            fallacies: evt.data.detected_fallacies as never[],
          });
        } else if (evt.event === "delta") {
          setOutput((prev) => prev + (evt.data.text as string));
        } else if (evt.event === "done") {
          const cites = (evt.data.citations_formatted as string[]) || [];
          const quality = evt.data.quality as Record<string, number> | undefined;
          const note = evt.data.length_note as string | null;
          if (note) notify(note);
          setRightOpen(true);
          setSide({
            title: "引用来源",
            body: (
              <div>
                {cites.length === 0 && <div className="muted pad">本次回答无库内引用（知识库可能没有相关内容）</div>}
                <ol className="cite-list">
                  {cites.map((c, i) => <li key={i}>{c}</li>)}
                </ol>
                {quality && (
                  <div className="quality">
                    上下文相关性 {Number(quality.context_relevance ?? 0).toFixed(3)} ·
                    切块利用率 {Number(quality.chunk_utilization ?? 0).toFixed(3)}
                  </div>
                )}
              </div>
            ),
          });
        }
      }, ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) notify(`生成失败: ${e}`);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();
  const demoStyle = opts?.styles?.[style]?.demo_warning;

  return (
    <div className="panel rebut">
      <textarea className="arg-input" rows={3} value={argument}
                placeholder="输入对方论点，例如：市场经济已经失败了"
                onChange={(e) => setArgument(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) run(); }} />
      <div className="controls">
        <label>立场
          <select value={stance} onChange={(e) => setStance(e.target.value)}>
            {stances.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
          </select>
        </label>
        <label>格式
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(opts?.formats || {}).map(([k, v]) =>
              <option key={k} value={k}>{v.split("：")[0]}</option>)}
          </select>
        </label>
        <label>风格
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {Object.entries(opts?.styles || {}).map(([k, v]) =>
              <option key={k} value={k}>{v.label}{v.demo_warning ? "（反面演示）" : ""}</option>)}
          </select>
        </label>
        <label>字数
          <input className="len" type="number" placeholder="默认" min={20}
                 max={opts?.max_length ?? 2000} value={length}
                 onChange={(e) => setLength(e.target.value)} />
        </label>
        <label>引用
          <select value={citeFmt} onChange={(e) => setCiteFmt(e.target.value)}>
            {(opts?.cite_formats || ["plain"]).map((c) =>
              <option key={c} value={c}>{{ plain: "普通", gbt7714: "GB/T 7714", apa: "APA" }[c] || c}</option>)}
          </select>
        </label>
        <label>检索
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {(opts?.modes || ["hybrid"]).map((m) =>
              <option key={m} value={m}>{MODE_LABELS[m] || m}</option>)}
          </select>
        </label>
        <label>坐标中心
          <select value={center} onChange={(e) => setCenter(e.target.value)}>
            <option value="">（不启用）</option>
            {centers.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="chk">
          <input type="checkbox" checked={fallacy}
                 onChange={(e) => setFallacy(e.target.checked)} /> 谬误检测
        </label>
        {running
          ? <button className="primary stop" onClick={stop}>停止</button>
          : <button className="primary" onClick={run} disabled={!argument.trim()}>生成反驳（Ctrl+Enter）</button>}
      </div>

      {demoStyle && (
        <div className="demo-warn">⚠ 反面演示风格——输出将展示错误论证方式，仅供识别学习，勿实际使用</div>
      )}
      {meta.fallacies && meta.fallacies.length > 0 && (
        <div className="fallacy-box">
          {meta.fallacies.map((f, i) => (
            <div key={i} className="fallacy-item">
              疑似<b>{f.name}</b>：「{f.quote}」——{f.reason}
            </div>
          ))}
        </div>
      )}

      <div className="output" ref={outRef}>
        {output
          ? <pre className="md-preview">{output}</pre>
          : <div className="muted pad">{running ? "检索知识库并生成中…" : "生成结果显示在这里"}</div>}
      </div>
      {meta.provider && <div className="muted small pad-h">模型：{meta.provider}</div>}
    </div>
  );
}
