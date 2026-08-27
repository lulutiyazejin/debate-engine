// 文档合并对话框（0.1.8 M6）：按标题【第 N 期】正则自动预排 + 上下调序 +
// 选目标文档（默认第一篇）→ NDJSON 进度（BgTask 断流不中断，自动重连）。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ndjsonPostResume } from "../lib/ndjson";
import type { DocRow } from "../App";

interface Props {
  docs: DocRow[];              // 待合并集（右键入口传入，≥2）
  notify: (msg: string) => void;
  onClose: () => void;
  onDone: () => void;
}

// 【第 N 期】/（N）/ 第 N 部 等分期序号抽取（无匹配排后面保持原序）
const periodNo = (title: string): number => {
  const m = title.match(/第\s*([0-9一二三四五六七八九十百]+)\s*[期部卷册篇]/)
    || title.match(/[（(]\s*(\d+)\s*[)）]/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const zh = "一二三四五六七八九十";
  const s = m[1];
  if (/^\d+$/.test(s)) return Number(s);
  // 简体数字粗转（一~九十够用）
  let n = 0;
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    n = (a ? zh.indexOf(a) + 1 : 1) * 10 + (b ? zh.indexOf(b) + 1 : 0);
  } else {
    n = zh.indexOf(s) + 1;
  }
  return n > 0 ? n : Number.MAX_SAFE_INTEGER;
};

export default function MergeDialog({ docs, notify, onClose, onDone }: Props) {
  const presorted = useMemo(() =>
    [...docs].sort((a, b) =>
      periodNo(a.title || "") - periodNo(b.title || "")), [docs]);
  const [order, setOrder] = useState<DocRow[]>(presorted);
  const [targetId, setTargetId] = useState(presorted[0]?.doc_id || "");
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const start = async () => {
    setRunning(true); setPct(0); setMsg("连接中…");
    try {
      await ndjsonPostResume("/api/knowledge/merge",
        { doc_ids: order.map((d) => d.doc_id), target_id: targetId },
        (evt) => {
          if (evt.done) {
            notify(evt.detail || (evt.ok ? "合并完成" : "合并失败"));
            if (evt.ok) { onDone(); onClose(); }
          } else {
            if (typeof evt.percent === "number") setPct(evt.percent);
            if (evt.status) setMsg(evt.status);
          }
        });
    } catch (e) { notify(`合并失败: ${e}`); }
    finally { setRunning(false); }
  };

  return createPortal(
    <div className="reader-backdrop" onClick={() => !running && onClose()}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}
           style={{ width: 480 }}>
        <h3>合并文档（{order.length} 篇）</h3>
        <p className="muted small">
          按分期序号已自动预排，可调顺序；源文档记录并入目标后删除，
          archive 原件全保留。合并中断开页面任务仍在后台继续。
        </p>
        {order.map((d, i) => (
          <div key={d.doc_id} className="param-row" style={{ gap: 8 }}>
            <label className="chk" style={{ flex: 1, minWidth: 0 }}>
              <input type="radio" name="merge-target"
                     checked={targetId === d.doc_id}
                     onChange={() => setTargetId(d.doc_id)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {i + 1}. {d.title || d.doc_id}
                {targetId === d.doc_id && <em className="muted small">（目标）</em>}
              </span>
            </label>
            <button className="link" disabled={running || i === 0}
                    onClick={() => move(i, -1)}>↑</button>
            <button className="link" disabled={running || i === order.length - 1}
                    onClick={() => move(i, 1)}>↓</button>
          </div>
        ))}
        {running && (
          <div className="busy"><div className="spinner sm" />{pct}% · {msg}</div>
        )}
        <div className="dlg-actions">
          <button disabled={running} onClick={onClose}>取消</button>
          <button className="primary" disabled={running || order.length < 2}
                  onClick={start}>
            {running ? "合并中…" : "开始合并"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
