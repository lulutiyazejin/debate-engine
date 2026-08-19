// 0.1.4 批 5（决策 11）：组件中心——卡片四态（未装/下载中/已装/禁用）。
// 下载走 NDJSON 进度流（断点续传由后端负责）；BGE-M3 装完引导全库重嵌入。
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { ndjsonPost, fmtSpeed } from "../../lib/ndjson";

interface CompRow {
  name: string; label: string; kind: string; size_hint: string;
  desc: string; state: "missing" | "installed" | "disabled"; homepage: string;
}
interface CompList {
  components: CompRow[];
  embedder: { impl: string; model: string; is_fallback: boolean };
  reembed_pending: number;
}

const STATE_LABEL = { missing: "未安装", installed: "已安装", disabled: "已禁用" } as const;

export default function ComponentsSection({ notify }: { notify: (msg: string) => void }) {
  const [data, setData] = useState<CompList | null>(null);
  const [busy, setBusy] = useState("");        // 正在下载/重嵌入的组件名
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(() => {
    api.get<CompList>("/api/components").then(setData).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const runStream = async (key: string, path: string) => {
    setBusy(key); setPct(0); setMsg("连接中…");
    try {
      await ndjsonPost(path, {}, (evt) => {
        if (evt.done) notify(evt.detail || (evt.ok ? "完成" : "失败"));
        else {
          if (typeof evt.percent === "number") setPct(evt.percent);
          if (evt.status) setMsg(evt.status);
          else if (typeof evt.speed_bps === "number") setMsg(fmtSpeed(evt.speed_bps));
        }
      });
    } catch (e) { notify(`失败: ${e}`); }
    finally { setBusy(""); refresh(); }
  };

  const toggle = async (c: CompRow) => {
    try {
      const r = await api.post<{ detail?: string }>(
        `/api/components/${c.name}/disable?enable=${c.state === "disabled"}`, {});
      notify(r.detail || (c.state === "disabled" ? "已启用" : "已禁用"));
      refresh();
    } catch (e) { notify(`操作失败: ${e}`); }
  };

  const remove = async (c: CompRow) => {
    if (!window.confirm(`删除组件 ${c.label}？可随时重新下载。`)) return;
    try { await api.del(`/api/components/${c.name}`); notify("已删除"); refresh(); }
    catch (e) { notify(`删除失败: ${e}`); }
  };

  return (
    <>
      <h3>组件中心</h3>
      <p className="muted small">
        大体积可选组件按需下载（断点续传，走「网络与代理」设置）；装完热生效，禁用可排障。
        当前向量实现：<code>{data?.embedder.model || "…"}</code>
        {data?.embedder.is_fallback && <span className="badge warn" style={{ marginLeft: 6 }}>降级中</span>}
      </p>
      {(data?.components || []).map((c) => (
        <div key={c.name} className="provider-card">
          <div className="provider-head">
            <b>{c.label}　<span className="muted small">{c.size_hint}</span></b>
            <span className={"badge " + (c.state === "installed" ? "ok"
                             : c.state === "disabled" ? "warn" : "")}>
              {STATE_LABEL[c.state]}</span>
          </div>
          <div className="muted small">{c.desc}</div>
          <div className="controls">
            {busy === c.name ? (
              <span className="pull-progress" title={msg}>
                <i style={{ width: `${pct}%` }} />
                <em>{pct}% {msg}</em>
              </span>
            ) : c.kind === "external" ? (
              <a className="link" href={c.homepage} target="_blank" rel="noreferrer">
                官网安装说明 ↗</a>
            ) : (
              <>
                <button disabled={!!busy}
                        onClick={() => runStream(c.name, `/api/components/${c.name}/install`)}>
                  {c.state === "missing" ? "下载并启用" : "重新下载"}</button>
                {c.state !== "missing" && (
                  <>
                    <button disabled={!!busy} onClick={() => toggle(c)}>
                      {c.state === "disabled" ? "启用" : "禁用"}</button>
                    <button className="danger-btn" disabled={!!busy}
                            onClick={() => remove(c)}>删除</button>
                  </>
                )}
              </>
            )}
            {c.name === "bge-m3" && c.state === "installed" && (data?.reembed_pending ?? 0) > 0 && (
              busy === "reembed" ? (
                <span className="pull-progress" title={msg}>
                  <i style={{ width: `${pct}%` }} />
                  <em>{pct}% 重嵌入中…</em>
                </span>
              ) : (
                <button className="primary" disabled={!!busy}
                        onClick={() => runStream("reembed", "/api/components/reembed")}>
                  全库重嵌入（待升级 {data?.reembed_pending} 块）</button>
              )
            )}
          </div>
        </div>
      ))}
    </>
  );
}
