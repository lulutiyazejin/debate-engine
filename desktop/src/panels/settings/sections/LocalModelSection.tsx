// 设置·本地模型分区（0.1.5 批 3）：
// H2 硬件探测推荐行 + F1 矩阵精选卡（荐/需升级徽标）+ 自由输入 pull +
// F2 上下文档位（自动/手动五档+每档显存预估）+ F3b 一键启动/下载通道 +
// F3c 本地 GGUF 导入。数据源=G2 模型矩阵（后端单一真源）。
import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, engineBase } from "../../../api";

export interface Candidate {
  name: string; label: string; vram_gb: number; window: number;
  speed: string; quality: string; zh: string; good_at: string;
  min_runtime: string; compat_ok: boolean; recommended: boolean;
}
export interface OllamaStatus {
  running: boolean; hint?: string; installed_models: string[];
  active_model?: string; version?: string | null;
  channel?: { mode: string; detail: string };
  candidates: Candidate[];
}
interface Hardware {
  has_gpu: boolean; gpu_name: string; vram_gb: number; ram_gb: number;
  recommend: string | null; note: string;
}
interface CtxInfo {
  mode: "auto" | "manual"; value: number; auto_value: number; model: string;
  gears: { ctx: number; vram_gb: number; tight: boolean }[];
  gpu_vram_gb: number;
}

interface Props {
  notify: (msg: string) => void;
  onChanged: () => void;   // pull 完成后刷新服务商/任务落点
  tick: number;            // 全局刷新脉冲
}

const fmtK = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}k` : `${n}`);

export default function LocalModelSection({ notify, onChanged, tick }: Props) {
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [ctx, setCtx] = useState<CtxInfo | null>(null);
  const [pulling, setPulling] = useState("");
  const [pullPct, setPullPct] = useState(0);
  const [pullMsg, setPullMsg] = useState("");
  const [freeName, setFreeName] = useState("");
  const [serving, setServing] = useState(false);
  const [ggufPath, setGgufPath] = useState("");
  const [ggufName, setGgufName] = useState("");
  const [importing, setImporting] = useState(false);

  const refreshAll = useCallback((probe = 0) => {
    api.get<OllamaStatus>("/api/config/ollama/status").then(setOllama).catch(() => {});
    api.get<Hardware>(`/api/config/hardware${probe ? "?refresh=1" : ""}`)
      .then(setHw).catch(() => {});
    api.get<CtxInfo>("/api/config/ollama/ctx").then(setCtx).catch(() => {});
  }, []);
  useEffect(() => refreshAll(0), [refreshAll, tick]);

  // 一键 pull（NDJSON 进度流）
  const pullModel = async (name: string) => {
    setPulling(name); setPullPct(0); setPullMsg("连接中…");
    try {
      const r = await fetch(`${engineBase()}/api/config/ollama/pull`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok || !r.body) throw new Error(`${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const evt = JSON.parse(line);
          if (evt.done) {
            notify(evt.ok ? `${name} 已下载并设为本地默认模型（热生效）`
                          : `下载失败：${evt.detail}（可到「网络与代理」改代理后重试）`);
          } else {
            if (typeof evt.percent === "number") setPullPct(evt.percent);
            if (evt.status) setPullMsg(evt.status);
          }
        }
      }
    } catch (e) { notify(`下载失败: ${e}（可到「网络与代理」改代理后重试）`); }
    finally { setPulling(""); refreshAll(0); onChanged(); }
  };

  // F3b：一键启动（隐藏窗+代理注入）
  const serve = async () => {
    setServing(true);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(
        "/api/config/ollama/serve", {});
      notify(r.detail);
    } catch (e) { notify(`启动失败: ${e}`); }
    finally { setServing(false); refreshAll(0); onChanged(); }
  };

  // F2：档位写入（热生效）
  const patchCtx = async (mode: "auto" | "manual", value?: number) => {
    try {
      const r = await api.patch<CtxInfo>("/api/config/ollama/ctx",
        { mode, value: value ?? 0 });
      setCtx(r);
      notify(mode === "auto" ? "上下文改回自动档（按模型推荐值）"
                             : `上下文手动档 ${fmtK(value!)} 已生效`);
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  // 0.1.6 项 2：系统文件选择器选 .gguf；命名空时自动取文件名
  // （去 .gguf、小写、非法字符→-，符后端 GgufImport pattern）
  const browseGguf = async () => {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "GGUF 权重", extensions: ["gguf"] }],
    });
    if (typeof p !== "string") return;
    setGgufPath(p);
    if (!ggufName.trim()) {
      const base = p.replace(/\\/g, "/").split("/").pop() || "";
      const nm = base.replace(/\.gguf$/i, "").toLowerCase()
        .replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
      if (nm) setGgufName(nm);
    }
  };

  // F3c：GGUF 导入
  const importGguf = async () => {
    if (!ggufPath.trim() || !ggufName.trim()) { notify("请填写 GGUF 路径与模型名"); return; }
    setImporting(true);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(
        "/api/config/ollama/import-gguf",
        { path: ggufPath.trim(), name: ggufName.trim() });
      notify(r.detail);
      if (r.ok) { setGgufPath(""); setGgufName(""); }
    } catch (e) { notify(`导入失败: ${e}`); }
    finally { setImporting(false); refreshAll(0); onChanged(); }
  };

  const installed = (name: string) =>
    !!ollama?.installed_models.some((m) => m.split(":")[0] === name.split(":")[0]);

  return (
    <>
      <h3>本地模型（Ollama）</h3>
      {/* H2 硬件推荐行 */}
      {hw && (
        <div className="param-row"><span>本机硬件</span>
          <span className="hw-line">
            {hw.has_gpu
              ? <>检测到 {hw.gpu_name} · {hw.vram_gb}GB / 内存 {hw.ram_gb}GB
                  {hw.recommend && <> → 推荐 <code>{hw.recommend}</code>
                    <button className="link" disabled={!ollama?.running || !!pulling}
                            onClick={() => pullModel(hw.recommend!)}>一键下载</button></>}
                </>
              : <span className="muted small">{hw.note}</span>}
            <button className="link" onClick={() => refreshAll(1)}>重新探测</button>
          </span>
        </div>
      )}
      {!ollama ? <p className="muted small">探测中…</p> : <>
        <div className="param-row"><span>运行状态</span>
          <span>
            <span className={"badge " + (ollama.running ? "ok" : "warn")}>
              {ollama.running ? `运行中${ollama.version ? ` v${ollama.version}` : ""}` : "未运行"}</span>
            {!ollama.running && (
              <button style={{ marginLeft: 8 }} disabled={serving} onClick={serve}>
                {serving ? "启动中…" : "一键启动"}</button>)}
          </span></div>
        {!ollama.running && <p className="muted small">{ollama.hint}（「一键启动」会按代理设置注入下载通道，无弹窗）</p>}
        {ollama.channel && (
          <div className="param-row"><span>下载通道</span>
            <span className="muted small">
              {ollama.channel.mode === "proxy" ? `代理 ${ollama.channel.detail}`
                : ollama.channel.detail /* 0.1.6 项 1：system 显解析后真实地址 */}
            </span></div>)}
        {ollama.active_model && (
          <div className="param-row"><span>当前生效模型</span><code>{ollama.active_model}</code></div>)}
        {ollama.installed_models.length > 0 && (
          <div className="param-row"><span>已安装</span>
            <span className="muted small">{ollama.installed_models.join("、")}</span></div>)}

        <h3>精选模型</h3>
        <p className="muted small">下载完成立即设为本地默认模型并热生效（任务落点随即可见），无需重启。</p>
        {ollama.candidates.map((c) => (
          <div key={c.name} className="model-card">
            <div className="model-head">
              <span>{c.label}　<code>{c.name}</code>
                {c.recommended && <span className="badge ok" title="按本机显存推荐">荐</span>}
                {!c.compat_ok && <span className="badge warn"
                  title={`需 Ollama ≥ ${c.min_runtime}`}>需升级 Ollama 才能跑</span>}
              </span>
              {pulling === c.name ? (
                <span className="pull-progress" title={pullMsg}>
                  <i style={{ width: `${pullPct}%` }} />
                  <em>{pullPct}% {pullMsg}</em>
                </span>
              ) : (
                <button disabled={!ollama.running || !!pulling || !c.compat_ok}
                        onClick={() => pullModel(c.name)}>
                  {installed(c.name) ? "重新下载" : "下载并启用"}</button>
              )}
            </div>
            <div className="model-meta muted small">
              显存(Q4) {c.vram_gb}GB · 窗 {fmtK(c.window)} · 速度{c.speed} ·
              质量{c.quality} · {c.zh} · {c.good_at}
            </div>
          </div>
        ))}
        <div className="param-row"><span>其他模型</span>
          <span className="controls">
            <input value={freeName} placeholder="任意 Ollama 模型名，如 phi4:14b"
                   onChange={(e) => setFreeName(e.target.value)} />
            <button disabled={!ollama.running || !!pulling || !freeName.trim()}
                    onClick={() => pullModel(freeName.trim())}>下载并启用</button>
          </span></div>

        {/* F2 上下文档位 */}
        {ctx && (
          <>
            <h3>上下文长度</h3>
            <p className="muted small">
              当前模型 <code>{ctx.model || "（未设）"}</code>，自动档按模型推荐
              {fmtK(ctx.auto_value)}；手动档换挡热生效。显存预估=权重(Q4)+KV×档长+2GB。
            </p>
            <div className="param-row"><span>档位</span>
              <span className="controls">
                <label className="chk">
                  <input type="radio" checked={ctx.mode === "auto"}
                         onChange={() => patchCtx("auto")} />
                  自动（{fmtK(ctx.auto_value)}）
                </label>
                <label className="chk">
                  <input type="radio" checked={ctx.mode === "manual"}
                         onChange={() => patchCtx("manual", ctx.value || ctx.auto_value)} />
                  手动
                </label>
              </span></div>
            {ctx.mode === "manual" && (
              <div className="param-row"><span>手动档</span>
                <span className="controls ctx-gears">
                  {ctx.gears.map((g) => (
                    <button key={g.ctx}
                            className={ctx.value === g.ctx ? "gear-on" : ""}
                            title={`预估显存 ${g.vram_gb}GB${g.tight ? "（超本机显存）" : ""}`}
                            onClick={() => patchCtx("manual", g.ctx)}>
                      {fmtK(g.ctx)}
                      <em>{g.vram_gb}GB{g.tight ? " ⚠" : ""}</em>
                    </button>
                  ))}
                </span></div>)}
            {ctx.mode === "manual" &&
              ctx.gears.find((g) => g.ctx === ctx.value)?.tight && (
              <p className="muted small">⚠ 该档预估显存超过本机显存，可能回落 CPU 变慢（不禁止）。</p>)}
          </>
        )}

        {/* F3c GGUF 导入 */}
        <h3>本地 GGUF 导入</h3>
        <p className="muted small">全断网保底：选择本地 .gguf 权重文件导入为 Ollama 模型（隐藏窗执行）。</p>
        <div className="param-row"><span>GGUF 路径</span>
          <span className="controls">
            <input value={ggufPath} placeholder="C:\\models\\qwen2.5-7b-q4.gguf"
                   onChange={(e) => setGgufPath(e.target.value)} />
            <button onClick={browseGguf}>浏览</button>
          </span></div>
        <div className="param-row"><span>命名为</span>
          <span className="controls">
            <input value={ggufName} placeholder="my-qwen:7b"
                   onChange={(e) => setGgufName(e.target.value)} />
            <button disabled={!ollama.running || importing} onClick={importGguf}>
              {importing ? "导入中…" : "导入"}</button>
          </span></div>
      </>}
      <div className="controls">
        <button onClick={() => refreshAll(0)}>刷新状态</button>
      </div>
    </>
  );
}
