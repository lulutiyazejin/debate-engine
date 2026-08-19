// 回答输出面板（0.1.4 批 3 三轴合一）：论点输入 + 主行（风格/立场/格式/字数）+
// 高级折叠（引用/检索/坐标中心/谬误）+ SSE 流式输出 + 谬误标注 + 引用推送右栏。
// 意图由风格推导（rebuttal→rebut / critique→critique / evaluate→evaluate，其余→rebut）；
// stance_free 风格（评价）隐藏立场选择并以 stance="none" 全库平权检索。
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, rebutStream } from "../api";

interface Options {
  formats: Record<string, string>;
  styles: Record<string, { label: string; demo_warning: boolean;
                           stance_free?: boolean }>;
  cite_formats: string[];
  modes: string[];
  max_length: number;
}

interface Props {
  stances: { name: string; label?: string; blacklist?: string[] }[];
  prefill: { stance?: string; argument?: string; style?: string };
  setSide: (v: { title: string; body: ReactNode } | null) => void;
  setRightOpen: (v: boolean) => void;
  notify: (msg: string) => void;
  materialIds?: number[];        // 素材篮强制引用（项目18）
  onDone?: () => void;           // 生成完成（历史/素材角标刷新）
}

const MODE_LABELS: Record<string, string> = {
  keyword: "关键词", semantic: "语义", hybrid: "混合", smart: "智能",
};

// 批 3：风格→意图（历史记录与后端 extra 兼容）
const STYLE_INTENT: Record<string, string> = {
  rebuttal: "rebut", critique: "critique", evaluate: "evaluate",
};

export default function RebutPanel({ stances, prefill, setSide, setRightOpen,
                                     notify, materialIds = [], onDone }: Props) {
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
  const [advOpen, setAdvOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [meta, setMeta] = useState<{ provider?: string; fallacies?: { name: string; quote: string; reason: string }[] }>({});
  // 0.1.5 H1：交互槽失败动作 toast（切换/重试/离线模板三钮）
  const [slotFail, setSlotFail] =
    useState<{ failed: string; reason: string; next: string | null } | null>(null);
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
    if (prefill.style) setStyle(prefill.style);
  }, [prefill]);

  useEffect(() => {
    if (!stance && stances.length) setStance(stances[0].name);
  }, [stances, stance]);

  // 流式输出时自动滚底
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [output]);

  const stanceFree = !!opts?.styles?.[style]?.stance_free;
  const blacklist = stances.find((s) => s.name === stance)?.blacklist || [];
  const blockedCount = Object.keys(opts?.styles || {})
    .filter((k) => blacklist.includes(k)).length;

  // 切立场后在选笔法被黑 → 自动回落默认 + 提示（决策 16-C，不静默偷换）
  useEffect(() => {
    if (blacklist.includes(style)) {
      setStyle("rebuttal");
      const label = stances.find((s) => s.name === stance)?.label || stance;
      notify(`「${opts?.styles?.[style]?.label || style}」与 ${label} 不兼容，已切换为默认笔法`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stance]);

  const run = async (providerOverride?: string) => {
    if (!argument.trim() || running) return;
    setRunning(true);
    setOutput("");
    setMeta({});
    setSlotFail(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await rebutStream({
        argument: argument.trim(),
        stance: stanceFree ? "none" : stance,   // 批 3：评价不站队
        format, style,
        length: length ? Number(length) : null,
        cite_format: citeFmt, fallacy, mode,
        center: center || null, stream: true,
        intent: STYLE_INTENT[style] || "rebut",
        material_ids: materialIds,
        provider: providerOverride || null,
      }, (evt) => {
        if (evt.event === "slot_failed") {
          // H1：不自动降级，交用户拍板
          setSlotFail(evt.data as unknown as
            { failed: string; reason: string; next: string | null });
        } else if (evt.event === "meta") {
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
          // 0.1.5 A1：中立评价存档提示
          if (evt.data.neutral_archived) notify("已存入中立评价档案");
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
      onDone?.();
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
      {/* 主行：风格 / 立场 / 格式 / 字数 + 生成（批 3 决策 14） */}
      <div className="controls">
        <label>风格
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {Object.entries(opts?.styles || {}).map(([k, v]) => {
              const blocked = blacklist.includes(k);
              return (
                <option key={k} value={k} disabled={blocked}
                        title={blocked ? "该笔法与当前立场的世界观冲突（可在立场 skill 的 method_blacklist 修改）" : undefined}>
                  {v.label}{v.demo_warning ? "（反面演示）" : ""}{blocked ? "（与当前立场不兼容）" : ""}
                </option>
              );
            })}
          </select>
        </label>
        {!stanceFree && (
          <label>立场
            <select value={stance} onChange={(e) => setStance(e.target.value)}>
              {stances.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
            </select>
          </label>
        )}
        {stanceFree && <span className="muted small">评价不站队：多立场权衡，全库平权检索</span>}
        <label>格式
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(opts?.formats || {}).map(([k, v]) =>
              <option key={k} value={k}>{v.split("：")[0]}</option>)}
          </select>
        </label>
        <label>字数
          <input className="len" type="number" placeholder="默认" min={20}
                 max={opts?.max_length ?? 2000} value={length}
                 onChange={(e) => setLength(e.target.value)} />
        </label>
        {running
          ? <button className="primary stop" onClick={stop}>停止</button>
          : <button className="primary" onClick={() => run()} disabled={!argument.trim()}>
              生成回答（Ctrl+Enter）</button>}
        <button className="fold" onClick={() => setAdvOpen(!advOpen)}>
          高级 {advOpen ? "▾" : "▸"}</button>
      </div>

      {/* 高级折叠：引用 / 检索 / 坐标中心 / 谬误检测（设一次基本不动） */}
      {advOpen && (
        <div className="controls">
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
          {blockedCount > 0 && (
            <span className="muted small">{blockedCount} 个笔法与当前立场不兼容（下拉内灰显）</span>
          )}
        </div>
      )}

      {demoStyle && (
        <div className="demo-warn">⚠ 反面演示风格——输出将展示错误论证方式，仅供识别学习，勿实际使用</div>
      )}
      {/* 0.1.5 H1：槽失败动作 toast（不自动降级，三钮交用户拍板） */}
      {slotFail && !running && (
        <div className="demo-warn slot-toast">
          ① {slotFail.failed} 失败（{slotFail.reason}）。
          {slotFail.next ? <>切到 ② {slotFail.next}？</> : <>无后备槽。</>}
          <span className="controls" style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
            {slotFail.next && (
              <button onClick={() => run(slotFail.next!)}>切换</button>)}
            <button onClick={() => run(slotFail.failed)}>重试</button>
            <button onClick={() => run("offline")}>离线模板</button>
          </span>
        </div>
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
          ? (() => {
              // Glance 要点先行（项目17）：完成后首段大字，其余正常节奏
              if (running) return <pre className="md-preview">{output}</pre>;
              const cut = output.indexOf("\n\n");
              const lead = cut > 0 ? output.slice(0, cut) : output;
              const rest = cut > 0 ? output.slice(cut + 2) : "";
              return (
                <div className="glance">
                  <div className="glance-lead">{lead}</div>
                  {rest && <pre className="md-preview">{rest}</pre>}
                </div>
              );
            })()
          : <div className="muted pad">{running ? "检索知识库并生成中…" : "生成结果显示在这里"}</div>}
      </div>
      {meta.provider && <div className="muted small pad-h">模型：{meta.provider}</div>}
    </div>
  );
}
