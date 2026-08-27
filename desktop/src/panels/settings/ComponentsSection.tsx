// 0.1.4 批 5（决策 11）：组件中心——卡片四态（未装/下载中/已装/禁用）。
// 下载走 NDJSON 进度流（断点续传由后端负责）；BGE-M3 装完引导全库重嵌入。
// 0.1.6 项 10：暂停/取消（AbortController 断流，.part 保留，续下接着传）。
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { askConfirm } from "../../components/AppDialog";
import { ndjsonPost, ndjsonPostResume, fmtSpeed } from "../../lib/ndjson";

interface CompRow {
  name: string; label: string; kind: string; size_hint: string;
  desc: string; state: "missing" | "installed" | "disabled" | "lib-missing"; homepage: string;
}
// 补丁项 7：MinerU 额外状态
interface MineruInstallInfo {
  installing?: boolean;
  pct?: number;
  msg?: string;
}
interface CompList {
  components: CompRow[];
  embedder: { impl: string; model: string; is_fallback: boolean };
  reembed_pending: number;
}

// 0.1.8 S2：lib-missing = 模型文件齐但 FlagEmbedding 运行库缺（冻结版旧包常态）
const STATE_LABEL = { missing: "未安装", installed: "已安装", disabled: "已禁用",
                      "lib-missing": "缺运行库" } as const;

export default function ComponentsSection({ notify }: { notify: (msg: string) => void }) {
  const [data, setData] = useState<CompList | null>(null);
  const [busy, setBusy] = useState("");        // 正在下载/重嵌/安装的组件名
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  // 补丁项 7：MinerU 安装进度独立态
  const [mineruInfo, setMineruInfo] = useState<MineruInstallInfo | null>(null);
  // 项 10：暂停态（保留进度，「继续」重发请求由 .part+Range 接着传）
  const [paused, setPaused] = useState<{ key: string; path: string; pct: number } | null>(null);
  const ctlRef = useRef<AbortController | null>(null);
  const abortKind = useRef<string>("");        // "pause" | "cancel" | ""

  const refresh = useCallback(() => {
    api.get<CompList>("/api/components").then(setData).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const runStream = async (key: string, path: string, label?: string) => {
    // 补丁项 7：MinerU 一键装也走同样流式协议（NDJSON）
    if (label === "MinerU 一键安装") {
      notify(`开始从系统 Python 下载安装 ${key}（约 3~5GB，不走代理；有 N 卡自动装 GPU 版）`);
    } else {
      notify(`开始下载 ${label || key}（断点续传，可暂停/取消）`);
    }
    setPaused(null); setBusy(key); setPct(0); setMsg("连接中...");
    const ctl = new AbortController();
    ctlRef.current = ctl; abortKind.current = "";
    let last = 0;
    // 0.1.8 S3：pip 类安装（mineru/补运行库）走 BgTask，断流 2s 自动重连续看；
    // 取消钮另走 cancel 端点真杀任务。普通下载流仍用断流=暂停语义。
    const isBgTask = key === "mineru" || label === "安装运行库";
    const post = isBgTask ? ndjsonPostResume : ndjsonPost;
    try {
      await post(path, {}, (evt) => {
        if (evt.done) notify(evt.detail || (evt.ok ? "完成" : "失败"));
        // 补丁项 7：MinerU 安装也更新 mineruInfo 供卡片显示
        else {
          if (typeof evt.percent === "number") {
            setPct(evt.percent); last = evt.percent;
            if (key === "mineru") setMineruInfo((prev) => ({ ...prev!, pct: evt.percent }));
          }
          if (evt.status) {
            setMsg(evt.status);
            if (key === "mineru") setMineruInfo((prev) => ({ ...prev!, msg: evt.status }));
          }
          else if (typeof evt.speed_bps === "number") setMsg(fmtSpeed(evt.speed_bps));
        }
      }, ctl.signal);
    } catch (e) {
      if (ctl.signal.aborted) {
        if (abortKind.current === "pause") setPaused({ key, path, pct: last });
        // cancel：回「下载并启用」，.part 保留下次续传
      } else notify(`失败: ${e}`);
    }
    finally { 
      if (key !== "mineru") {
        ctlRef.current = null; 
        setBusy(""); 
        refresh(); 
      } else {
        // MinerU 装完自刷新探测
        setTimeout(() => { 
          ctlRef.current = null; 
          setBusy(""); 
          refresh(); 
          setMineruInfo(null); 
        }, 500);
      }
    }
  };

  const interrupt = (kind: "pause" | "cancel") => {
    abortKind.current = kind;
    ctlRef.current?.abort();
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
    if (!(await askConfirm({ title: `删除组件 ${c.label}？`,
        body: "可随时重新下载。", danger: true }))) return;
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
                             : c.state === "disabled" || c.state === "lib-missing" ? "warn" : "")}>
              {STATE_LABEL[c.state]}</span>
          </div>
          <div className="muted small">{c.desc}</div>
          <div className="controls">
            {busy === c.name ? (
              <>
                <span className="pull-progress" title={msg}>
                  <i style={{ width: `${pct}%` }} />
                  <em>{pct}% {msg}</em>
                </span>
                {/* 项 10：断流不删 .part，继续/重下都走 Range 续传 */}
                <button onClick={() => interrupt("pause")}>暂停</button>
                <button className="danger-btn" onClick={() => interrupt("cancel")}>取消</button>
              </>
            ) : paused?.key === c.name ? (
              <>
                <span className="muted small">已暂停 · {paused.pct}%</span>
                <button className="primary" disabled={!!busy}
                        onClick={() => runStream(paused.key, paused.path)}>继续</button>
                <button className="danger-btn" disabled={!!busy}
                        onClick={() => setPaused(null)}>取消</button>
              </>
            ) : c.kind === "external" && c.name === "mineru" ? (
              // 补丁项 7：MinerU 优先一键装（有系统 Python 前提下）
              busy === c.name ? (
                <span className="pull-progress" title={msg}>
                  <i style={{ width: `${pct}%` }} />
                  <em>{pct}% {msg}</em>
                </span>
              ) : mineruInfo ? (
                <span className="pull-progress" title={mineruInfo.msg}>
                  <i style={{ width: `${mineruInfo.pct!}%` }} />
                  <em>安装中 · {mineruInfo.pct}%
                    {!(async () => {
                      // 安装中不刷新页面，保持进度
                    })()}
                  </em>
                </span>
              ) : c.state === "missing" ? (
                <button className="primary" disabled={!!busy}
                        onClick={() => runStream(c.name,
                          `/api/components/${c.name}/install`, "MinerU 一键安装")}>一键安装</button>
              ) : (
                <a className="link" href={c.homepage} target="_blank" rel="noreferrer">官网安装说明 ↗</a>
              )
            ) : c.kind === "external" ? (
              <a className="link" href={c.homepage} target="_blank" rel="noreferrer">
                官网安装说明 ↗</a>
            ) : (
              <>
                <button disabled={!!busy}
                        onClick={() => runStream(c.name, `/api/components/${c.name}/install`,
                          c.state === "lib-missing" ? "安装运行库" : c.label)}>
                  {c.state === "missing" ? "下载并启用"
                   : c.state === "lib-missing" ? "安装运行库" : "重新下载"}</button>
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
                        onClick={() => runStream("reembed", "/api/components/reembed", "全库重嵌入")}>
                  全库重嵌入（待升级 {data?.reembed_pending} 块）</button>
              )
            )}
          </div>
        </div>
      ))}
    </>
  );
}
