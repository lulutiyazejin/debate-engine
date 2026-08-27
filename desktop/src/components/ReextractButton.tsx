// 0.1.7 项 3：馆藏头部「重新提取坐标」按钮 + 内联进度。
// 后端是 hotfix5 线程模式后台任务：断流不中断，重复点击/刷新后=接入续看。
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ndjsonPost } from "../lib/ndjson";
import { askConfirm } from "./AppDialog";

interface Props {
  notify: (msg: string) => void;
  onDone: () => void;   // 完成后失效坐标缓存（VizPanel setCoordDocs(null)）
  pendingCoords?: number;   // 0.1.9 L3：待提取坐标数（>0 显黄色角标，点击=重提取，走同一 E2 确认）
}

export default function ReextractButton({ notify, onDone, pendingCoords = 0 }: Props) {
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const probed = useRef(false);

  const run = async () => {
    if (running) return;
    // 0.1.9 E2: 二次确认
    if (!(await askConfirm({ title: "全库重提取坐标", body: "将对当前库内全部文档重新运行章节摘要与 22 轴坐标提取（现有关系边会被清空），耗时较长，确定？" }))) return;
    setRunning(true); setPct(0); setMsg("连接中…");
    try {
      await ndjsonPost("/api/analysis/coords/reextract", {}, (evt) => {
        if (evt.done) {
          notify(evt.detail || (evt.ok ? "重提取完成" : "重提取失败"));
          if (evt.ok) onDone();
        } else {
          if (typeof evt.percent === "number") setPct(evt.percent);
          if (evt.status) setMsg(evt.status);
        }
      });
    } catch (e) { notify(`重提取失败: ${e}`); }
    finally { setRunning(false); }
  };

  // 刷新/重开页面后任务还在后台跑 → 自动接入续看进度
  useEffect(() => {
    if (probed.current) return;
    probed.current = true;
    api.get<{ running: boolean }>("/api/analysis/coords/reextract/status")
      .then((r) => { if (r.running) run(); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return running ? (
    <span className="reextract-live" title={msg}>
      重提取 {pct}% · {msg}
    </span>
  ) : (
    <span className="reextract-wrap">
      {pendingCoords > 0 && (
        <button className="badge-coords" onClick={run}
                title="这些文档坐标全 0（模型未运行时的兜底）；点击对全库重跑坐标提取">
          {pendingCoords} 本待提取坐标
        </button>
      )}
      <button className="link"
              title="对全库文档重跑章节摘要与 22 轴坐标提取（旧数据坐标全 0 / 疑似未提取时用；需本地模型或云端 Key 可用）"
              onClick={run}>重新提取坐标</button>
    </span>
  );
}
