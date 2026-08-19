// 设置面板（PLAN-0.1.2 项目23）：覆盖浮层内的六分区左导航。
// A 模型服务商（任务分工总览+自定义服务商）· B 生成与检索参数 · C 知识库 ·
// D 知识文件 · E 诊断与日志 · F 界面（主题/悬浮组/手势/快捷键）
import { useCallback, useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, engineBase } from "../api";
import { loadKeys } from "../App";
import { getThemePref, setThemePref, type ThemePref } from "../theme";

interface Provider { name: string; configured: boolean; available: boolean; model?: string }
interface TaskRow { task: string; label: string; chain: string[]; active: string }
interface CustomProv { name: string; url: string; model: string; tasks: string[]; has_key: boolean }
interface OllamaStatus {
  running: boolean; hint?: string; installed_models: string[];
  active_model?: string; candidates: { name: string; label: string }[];
}
interface StanceRow { name: string; title?: string; builtin?: boolean; doc_count?: number }
interface CheckRow { item: string; ok: boolean; detail: string }

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq（免费额度大，反驳生成快）",
  gemini: "Google Gemini（大窗口，适合全书摘要）",
  cerebras: "Cerebras（免费高速）",
  mistral: "Mistral（免费额度）",
  openrouter: "OpenRouter（聚合入口）",
  ollama: "Ollama（本机离线模型，无需 Key）",
};

const SECTIONS = [
  { key: "providers", label: "模型服务商" },
  { key: "localmodel", label: "本地模型" },
  { key: "network", label: "网络与代理" },
  { key: "params", label: "生成与检索" },
  { key: "kb", label: "知识库" },
  { key: "stancemgr", label: "立场管理" },
  { key: "skills", label: "知识文件" },
  { key: "diag", label: "诊断与日志" },
  { key: "ui", label: "界面" },
  { key: "about", label: "软件信息" },
] as const;

interface Props {
  notify: (msg: string) => void;
}

export default function SettingsPanel({ notify }: Props) {
  const [section, setSection] = useState<string>("providers");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [customs, setCustoms] = useState<CustomProv[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [kbBusy, setKbBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [params, setParams] = useState<Record<string, number>>({});
  const [cp, setCp] = useState({ name: "", url: "", key: "", model: "", tasks: [] as string[] });
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [overrideEdit, setOverrideEdit] = useState<string | null>(null);
  const [overrideModel, setOverrideModel] = useState("");
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [gestureOn, setGestureOn] = useState(() => localStorage.getItem("de.gesture") !== "off");
  const [gestureInv, setGestureInv] = useState(() => localStorage.getItem("de.gesture.invert") === "1");
  const [keySwitch, setKeySwitch] = useState(loadKeys().switch);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [winMem, setWinMem] = useState(() => localStorage.getItem("de.winmem") === "on");
  const [proxy, setProxy] = useState<{ mode: string; url: string }>({ mode: "off", url: "" });
  const [proxyUrl, setProxyUrl] = useState("");
  const [webEnrich, setWebEnrich] = useState(true);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [pulling, setPulling] = useState("");
  const [pullPct, setPullPct] = useState(0);
  const [pullMsg, setPullMsg] = useState("");
  const [stanceRows, setStanceRows] = useState<StanceRow[]>([]);
  const [stanceName, setStanceName] = useState("");
  const [stanceMd, setStanceMd] = useState("");
  const [version, setVersion] = useState("");
  const [checks, setChecks] = useState<CheckRow[] | null>(null);
  const [checking, setChecking] = useState(false);

  const refreshOllama = useCallback(() => {
    api.get<OllamaStatus>("/api/config/ollama/status").then(setOllama).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    api.get<{ providers: Provider[] }>("/api/config/providers")
      .then((r) => setProviders(r.providers)).catch(() => {});
    api.get<{ tasks: TaskRow[] }>("/api/config/tasks")
      .then((r) => setTasks(r.tasks)).catch(() => {});
    api.get<{ providers: CustomProv[] }>("/api/config/custom-providers")
      .then((r) => setCustoms(r.providers)).catch(() => {});
    api.get<Record<string, number>>("/api/config/params")
      .then(setParams).catch(() => {});
    api.get<{ stats: Record<string, number> }>("/api/knowledge/docs")
      .then((r) => setStats(r.stats)).catch(() => {});
    api.get<{ mode: string; url: string }>("/api/config/proxy")
      .then((r) => { setProxy(r); setProxyUrl(r.url); }).catch(() => {});
    api.get<{ enabled: boolean }>("/api/config/web-enrich")
      .then((r) => setWebEnrich(r.enabled)).catch(() => {});
    api.get<{ stances: StanceRow[] }>("/api/stances")
      .then((r) => setStanceRows(r.stances)).catch(() => {});
    api.get<{ version: string }>("/api/health")
      .then((r) => setVersion(r.version)).catch(() => {});
    refreshOllama();
  }, [refreshOllama]);
  useEffect(refresh, [refresh]);

  const saveKey = async (provider: string) => {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/config/key", { provider, key: keyInput.trim() });
      notify("已保存并热重载（无需重启）");
      setEditing(null); setKeyInput(""); refresh();
    } catch (e) { notify(`保存失败: ${e}`); } finally { setBusy(false); }
  };

  const removeKey = async (provider: string) => {
    if (!window.confirm(`移除 ${provider} 的 Key？`)) return;
    try { await api.del(`/api/config/key/${provider}`); notify("已移除"); refresh(); }
    catch (e) { notify(`移除失败: ${e}`); }
  };

  const testProv = async (name: string) => {
    setTesting(name);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(`/api/config/test/${name}`, {});
      notify(r.ok ? `${name} 连通正常 ✓` : `${name} 测试失败：${r.error}`);
    } catch (e) { notify(`测试失败: ${e}`); } finally { setTesting(""); }
  };

  const probeModels = async () => {
    if (!cp.url) { notify("先填 BaseURL 再拉取模型清单"); return; }
    setProbing(true);
    try {
      const r = await api.post<{ ok: boolean; models: string[]; error?: string }>(
        "/api/config/models-probe", { url: cp.url, key: cp.key });
      if (r.ok && r.models.length) {
        setModelOptions(r.models);
        if (!cp.model) setCp({ ...cp, model: r.models[0] });
        notify(`拉到 ${r.models.length} 个可选模型`);
      } else {
        setModelOptions([]);
        notify(`拉取失败（可手动输入模型名）：${r.error || "无模型"}`);
      }
    } catch (e) { notify(`拉取失败: ${e}`); } finally { setProbing(false); }
  };

  const saveOverride = async (provider: string) => {
    if (!overrideModel.trim()) return;
    try {
      await api.patch("/api/config/model-override",
        { provider, model: overrideModel.trim() });
      notify(`${provider} 默认模型已改为 ${overrideModel.trim()}（热生效）`);
      setOverrideEdit(null); setOverrideModel(""); refresh();
    } catch (e) { notify(`修改失败: ${e}`); }
  };

  const addCustom = async () => {
    if (!cp.name || !cp.url || !cp.model) { notify("名称 / BaseURL / 模型名必填"); return; }
    try {
      await api.post("/api/config/custom-providers", cp);
      notify(`自定义服务商 ${cp.name} 已加入${cp.tasks.length ? "并插入任务链首位" : ""}`);
      setCp({ name: "", url: "", key: "", model: "", tasks: [] });
      refresh();
    } catch (e) { notify(`添加失败: ${e}`); }
  };

  const delCustom = async (name: string) => {
    if (!window.confirm(`移除自定义服务商 ${name}？将同时从任务链中摘除。`)) return;
    try { await api.del(`/api/config/custom-providers/${name}`); notify("已移除"); refresh(); }
    catch (e) { notify(`移除失败: ${e}`); }
  };

  const patchParam = async (key: string, v: number) => {
    try {
      const r = await api.patch<Record<string, number>>("/api/config/params", { [key]: v });
      setParams(r);
      notify("参数已热生效");
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  const exportKb = async () => {
    const path = await saveDialog({
      title: "导出知识库分享包", defaultPath: "debate-kb.debkb",
      filters: [{ name: "知识库包", extensions: ["debkb"] }],
    });
    if (!path) return;
    setKbBusy(true);
    try {
      const r = await api.post<{ documents: number; size_bytes: number }>(
        "/api/kb/export", { path, include_vectors: true });
      notify(`导出完成：${r.documents} 文档，${(r.size_bytes / 1048576).toFixed(1)} MB`);
    } catch (e) { notify(`导出失败: ${e}`); } finally { setKbBusy(false); }
  };

  const importKb = async () => {
    const path = await openDialog({
      title: "选择知识库分享包",
      filters: [{ name: "知识库包", extensions: ["debkb"] }],
    });
    if (!path) return;
    setKbBusy(true);
    try {
      const m = await api.post<{ documents: number; embedding_model: string }>(
        "/api/kb/verify", { path });
      if (!window.confirm(`包内含 ${m.documents} 篇文档（嵌入模型 ${m.embedding_model}），合并入库？\n重复文档将跳过。`)) return;
      const r = await api.post<{ imported: number; skipped: number; reembedded: number }>(
        "/api/kb/import", { path, on_duplicate: "skip" });
      notify(`合并完成：新入 ${r.imported}，跳过 ${r.skipped}，重嵌入 ${r.reembedded}`);
    } catch (e) { notify(`导入失败: ${e}`); } finally { setKbBusy(false); }
  };

  const saveSwitchKey = (v: string) => {
    // 系统保留组合拒绝（Alt+Tab / Win 键由 OS 截获，设了也无效）
    if (/^(Alt\+Tab|Win\+|Meta\+)/i.test(v)) { notify("该组合被系统占用，无法使用"); return; }
    setKeySwitch(v);
    localStorage.setItem("de.keys", JSON.stringify({ ...loadKeys(), switch: v }));
    notify(`切面快捷键已改为 ${v}`);
  };

  // ---------- 0.1.3 C5：网络与代理 ----------
  const saveProxy = async (mode: string) => {
    if (mode === "custom" && !/^(https?|socks5):\/\//.test(proxyUrl)) {
      // 先切到自定义态让地址框出现，填完合法地址再落盘
      setProxy((p) => ({ ...p, mode: "custom" }));
      return;
    }
    try {
      const r = await api.patch<{ mode: string; url: string }>(
        "/api/config/proxy", { mode, url: mode === "custom" ? proxyUrl : "" });
      setProxy(r); setProxyUrl(r.url);
      notify("代理设置已热生效（本机地址始终直连）");
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  const toggleEnrich = async (v: boolean) => {
    try {
      await api.patch("/api/config/web-enrich", { enabled: v });
      setWebEnrich(v);
      notify(v ? "入库时将联网补充书目信息" : "已关闭联网补充（只用本地提取）");
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  const runChecks = async () => {
    setChecking(true);
    try {
      const r = await api.get<{ checks: CheckRow[] }>("/api/diagnostics/connectivity");
      setChecks(r.checks);
    } catch (e) { notify(`检测失败: ${e}`); } finally { setChecking(false); }
  };

  // ---------- 0.1.3 C5：本地模型一键 pull（NDJSON 进度流） ----------
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
                          : `下载失败：${evt.detail}`);
          } else {
            if (typeof evt.percent === "number") setPullPct(evt.percent);
            if (evt.status) setPullMsg(evt.status);
          }
        }
      }
    } catch (e) { notify(`下载失败: ${e}`); }
    finally { setPulling(""); refresh(); }
  };

  // ---------- 0.1.3 C5：立场管理 ----------
  const importStance = async () => {
    try {
      const r = await api.post<{ ok: boolean; title: string }>(
        "/api/stances/import", { name: stanceName.trim(), content: stanceMd });
      notify(`立场「${r.title}」已导入并热生效`);
      setStanceName(""); setStanceMd(""); refresh();
    } catch (e) { notify(`导入未通过：${e}`); }
  };

  const delStance = async (name: string) => {
    if (!window.confirm(`删除立场 ${name}？其名下文档不会删除，只失去检索偏好。`)) return;
    try { await api.del(`/api/stances/${name}`); notify("已删除并热生效"); refresh(); }
    catch (e) { notify(`删除失败: ${e}`); }
  };

  const copyTemplate = async () => {
    try {
      const r = await api.get<{ template: string }>("/api/stances/template");
      setStanceMd(r.template);
      navigator.clipboard?.writeText(r.template).catch(() => {});
      notify("模板已填入编辑框（并复制到剪贴板）");
    } catch (e) { notify(`获取模板失败: ${e}`); }
  };

  const provCard = (p: Provider) => (
    <div key={p.name} className="provider-card">
      <div className="provider-head">
        <b>{PROVIDER_LABELS[p.name] || p.name}</b>
        <span className={"badge " + (p.available ? "ok" : p.configured ? "warn" : "")}>
          {p.available ? "可用" : p.configured ? "已配置（暂不可用）" : "未配置"}
        </span>
      </div>
      {p.model && <div className="muted small">默认模型：{p.model}
        {overrideEdit === p.name ? (
          <span className="controls" style={{ display: "inline-flex", marginLeft: 8 }}>
            <input value={overrideModel} placeholder="新模型 ID"
                   onChange={(e) => setOverrideModel(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && saveOverride(p.name)} />
            <button className="primary" onClick={() => saveOverride(p.name)}>保存</button>
            <button onClick={() => setOverrideEdit(null)}>取消</button>
          </span>
        ) : (
          <button className="link" style={{ marginLeft: 8 }}
                  onClick={() => { setOverrideEdit(p.name); setOverrideModel(p.model || ""); }}>
            换模型</button>
        )}
      </div>}
      <div className="muted small">
        承担任务：{tasks.filter((t) => t.chain.includes(p.name))
          .map((t) => `${t.label}(第${t.chain.indexOf(p.name) + 1}位)`)
          .join("、") || "—"}
      </div>
      {p.name === "ollama" && !p.available && (
        <div className="muted small">未检测到本机 Ollama：安装后运行 <code>ollama serve</code> 即自动可用。</div>
      )}
      <div className="controls">
        {p.name !== "ollama" && (editing === p.name ? (
          <>
            <input className="key-input" type="password" value={keyInput}
                   placeholder="粘贴 API Key"
                   onChange={(e) => setKeyInput(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && saveKey(p.name)} />
            <button className="primary" disabled={busy || !keyInput.trim()}
                    onClick={() => saveKey(p.name)}>保存</button>
            <button onClick={() => { setEditing(null); setKeyInput(""); }}>取消</button>
          </>
        ) : (
          <>
            <button onClick={() => { setEditing(p.name); setKeyInput(""); }}>
              {p.configured ? "更换 Key" : "填入 Key"}</button>
            {p.configured &&
              <button className="danger-btn" onClick={() => removeKey(p.name)}>移除</button>}
          </>
        ))}
        <button disabled={testing === p.name} onClick={() => testProv(p.name)}>
          {testing === p.name ? "测试中…" : "连通测试"}</button>
      </div>
    </div>
  );

  return (
    <div className="settings2">
      <nav className="settings-nav">
        {SECTIONS.map((s) => (
          <button key={s.key} className={section === s.key ? "nav-on" : ""}
                  onClick={() => setSection(s.key)}>{s.label}</button>
        ))}
      </nav>
      <div className="settings-body">
        {section === "providers" && (
          <div className="panel settings">
            <h3>任务分工总览</h3>
            <p className="muted small">每类 AI 任务按优先级链依次尝试；全部不可用时降级离线模板。</p>
            <table className="task-table">
              <thead><tr><th>任务</th><th>用途</th><th>优先级链</th><th>当前落点</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task}>
                    <td><code>{t.task}</code></td>
                    <td>{t.label}</td>
                    <td className="muted">{t.chain.join(" → ")}</td>
                    <td><span className={"badge " + (t.active === "offline" ? "warn" : "ok")}>{t.active}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>内置服务商</h3>
            <p className="muted small">Key 保存在本机 .env，不上传；保存后热重载无需重启。</p>
            <div className="provider-list">{providers.map(provCard)}</div>
            <h3>自定义服务商（OpenAI 兼容）</h3>
            {customs.map((c) => (
              <div key={c.name} className="provider-card">
                <div className="provider-head"><b>{c.name}</b>
                  <span className="muted small">{c.model} @ {c.url}</span></div>
                <div className="muted small">加入任务链：{c.tasks.join("、") || "—"}</div>
                <div className="controls">
                  <button disabled={testing === c.name} onClick={() => testProv(c.name)}>连通测试</button>
                  <button className="danger-btn" onClick={() => delCustom(c.name)}>移除</button>
                </div>
              </div>
            ))}
            <div className="provider-card">
              <div className="controls wrap">
                <input placeholder="名称（英文）" value={cp.name}
                       onChange={(e) => setCp({ ...cp, name: e.target.value })} />
                <input placeholder="BaseURL（https://…/v1）" value={cp.url} className="wide"
                       onChange={(e) => setCp({ ...cp, url: e.target.value })} />
                <input placeholder="API Key（可空）" type="password" value={cp.key}
                       onChange={(e) => setCp({ ...cp, key: e.target.value })} />
                <input placeholder="模型名" value={cp.model} list="model-options"
                       onChange={(e) => setCp({ ...cp, model: e.target.value })} />
                <button disabled={probing} onClick={probeModels}>
                  {probing ? "拉取中…" : "拉取模型清单"}</button>
                <datalist id="model-options">
                  {modelOptions.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div className="controls wrap">
                <span className="muted small">加入任务链（插到首位）：</span>
                {tasks.map((t) => (
                  <label key={t.task} className="chk">
                    <input type="checkbox" checked={cp.tasks.includes(t.task)}
                           onChange={(e) => setCp({ ...cp, tasks: e.target.checked
                             ? [...cp.tasks, t.task] : cp.tasks.filter((x) => x !== t.task) })} />
                    {t.label}
                  </label>
                ))}
                <button className="primary" onClick={addCustom}>添加</button>
              </div>
            </div>
          </div>
        )}

        {section === "localmodel" && (
          <div className="panel settings">
            <h3>本地模型（Ollama）</h3>
            {!ollama ? <p className="muted small">探测中…</p> : <>
              <div className="param-row"><span>运行状态</span>
                <span className={"badge " + (ollama.running ? "ok" : "warn")}>
                  {ollama.running ? "运行中" : "未运行"}</span></div>
              {!ollama.running && <p className="muted small">{ollama.hint}</p>}
              {ollama.active_model && (
                <div className="param-row"><span>当前生效模型</span><code>{ollama.active_model}</code></div>)}
              {ollama.installed_models.length > 0 && (
                <div className="param-row"><span>已安装</span>
                  <span className="muted small">{ollama.installed_models.join("、")}</span></div>)}
              <h3>一键下载</h3>
              <p className="muted small">下载完成立即设为本地默认模型并热生效（任务落点表随即可见），无需重启。</p>
              {ollama.candidates.map((c) => (
                <div key={c.name} className="param-row">
                  <span>{c.label}　<code>{c.name}</code></span>
                  {pulling === c.name ? (
                    <span className="pull-progress" title={pullMsg}>
                      <i style={{ width: `${pullPct}%` }} />
                      <em>{pullPct}% {pullMsg}</em>
                    </span>
                  ) : (
                    <button disabled={!ollama.running || !!pulling}
                            onClick={() => pullModel(c.name)}>
                      {ollama.installed_models.some((m) => m.split(":")[0] === c.name.split(":")[0])
                        ? "重新下载" : "下载并启用"}</button>
                  )}
                </div>
              ))}
            </>}
            <div className="controls">
              <button onClick={refreshOllama}>刷新状态</button>
            </div>
          </div>
        )}

        {section === "network" && (
          <div className="panel settings">
            <h3>代理</h3>
            <p className="muted small">
              作用于全部外发请求（模型 API / 维基百科 / 百度百科）；
              本机地址（127.0.0.1 / localhost 的 Ollama 与引擎自身）始终直连不受影响。
            </p>
            {([["off", "不使用代理（直连）"], ["system", "跟随系统代理"],
               ["custom", "自定义地址"]] as const).map(([v, l]) => (
              <label key={v} className="chk">
                <input type="radio" name="proxymode" checked={proxy.mode === v}
                       onChange={() => saveProxy(v)} /> {l}
              </label>
            ))}
            {proxy.mode === "custom" && (
              <div className="controls">
                <input className="wide" value={proxyUrl}
                       placeholder="http://127.0.0.1:7890 或 socks5://…"
                       onChange={(e) => setProxyUrl(e.target.value)}
                       onBlur={() => saveProxy("custom")}
                       onKeyDown={(e) => e.key === "Enter" && saveProxy("custom")} />
              </div>
            )}
            <h3>联网补充元数据</h3>
            <label className="chk">
              <input type="checkbox" checked={webEnrich}
                     onChange={(e) => toggleEnrich(e.target.checked)} />
              入库时联网核对书目信息（维基百科 → 百度百科，失败自动跳过；确认屏标注字段来源）
            </label>
            <h3>连通自测</h3>
            <div className="controls">
              <button disabled={checking} onClick={runChecks}>
                {checking ? "检测中…" : "一键检测"}</button>
            </div>
            {checks && (
              <div className="ledger">
                {checks.map((c) => (
                  <div key={c.item} className="ledger-row diag-row">
                    <span>{c.item}</span>
                    <span className={"badge " + (c.ok ? "ok" : "warn")}>{c.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === "params" && (
          <div className="panel settings">
            <h3>生成与检索参数</h3>
            <p className="muted small">写入 settings.json 并立即热生效（跟知识库走，分享包不含）。</p>
            {[
              { key: "retrieval_top_k", label: "最终引用条数 Top-K", min: 1, max: 20 },
              { key: "retrieval_top_k_coarse", label: "粗检索每路 Top-K", min: 5, max: 100 },
              { key: "full_context_token_limit", label: "整书投喂 token 上限", min: 1000, max: 500000 },
            ].map((f) => (
              <div key={f.key} className="param-row">
                <span>{f.label}</span>
                <input type="number" min={f.min} max={f.max}
                       value={params[f.key] ?? ""}
                       onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })}
                       onBlur={(e) => patchParam(f.key, Number(e.target.value))} />
              </div>
            ))}
          </div>
        )}

        {section === "kb" && (
          <div className="panel settings">
            <h3>知识库统计</h3>
            <div className="stat-head">
              <div className="stat"><b>{stats.documents ?? 0}</b><span>文档</span></div>
              <div className="stat"><b>{stats.chunks ?? 0}</b><span>切块</span></div>
              <div className="stat"><b>{stats.arg_units ?? 0}</b><span>论证单元</span></div>
            </div>
            <h3>分享与备份</h3>
            <p className="muted small">
              导出包含：文档元数据、全部分块文本、向量、知识文件；
              <b>强制剥离日志、API Key、素材篮与回应历史</b>。备份可导出到网盘同步文件夹。
            </p>
            <div className="controls">
              <button className="primary" disabled={kbBusy} onClick={exportKb}>导出全库…</button>
              <button disabled={kbBusy} onClick={importKb}>导入分享包…</button>
              {kbBusy && <span className="muted small">处理中…</span>}
            </div>
          </div>
        )}

        {section === "stancemgr" && (
          <div className="panel settings">
            <h3>立场清单</h3>
            <p className="muted small">预置立场随包分发不可删；手动导入的立场可删除（文档不受影响）。</p>
            <div className="ledger">
              {stanceRows.map((s) => (
                <div key={s.name} className="ledger-row diag-row">
                  <span>{(s.title || s.name).replace(/^SKILL[:：]\s*/, "")}
                    <code style={{ marginLeft: 8 }}>{s.name}</code>
                    <span className="muted small" style={{ marginLeft: 8 }}>{s.doc_count ?? 0} 篇</span></span>
                  {s.builtin
                    ? <span className="muted small">预置</span>
                    : <button className="danger-btn" onClick={() => delStance(s.name)}>删除</button>}
                </div>
              ))}
            </div>
            <h3>导入新立场</h3>
            <p className="muted small">
              按模板六节撰写（世界观假设 / 反驳策略偏好 / 禁止使用的论证方式 /
              知识库检索偏好 / 默认回复风格 / Prompt 模板）；校验逐条报错，不静默拒载。
              <button className="link" onClick={copyTemplate}>取模板填入</button>
            </p>
            <div className="controls">
              <input value={stanceName} placeholder="立场 ID（仅英文 / 数字 / 下划线）"
                     onChange={(e) => setStanceName(e.target.value)} />
            </div>
            <textarea className="stance-import" value={stanceMd} rows={10}
                      placeholder={"# SKILL: 立场名称\n## 世界观假设\n…"}
                      onChange={(e) => setStanceMd(e.target.value)} />
            <div className="controls">
              <button className="primary" disabled={!stanceName.trim() || !stanceMd.trim()}
                      onClick={importStance}>校验并导入（热生效）</button>
            </div>
          </div>
        )}

        {section === "skills" && (
          <div className="panel settings">
            <h3>知识文件</h3>
            <p className="muted small">
              反驳风格（styles.md）、谬误表（fallacies.md）、坐标中心点（centers.md）、
              立场 Skill（stances/*.md）都是知识库 skills 目录下的普通 Markdown，
              用任何编辑器修改保存后，下次生成即生效。
            </p>
          </div>
        )}

        {section === "diag" && (
          <div className="panel settings">
            <h3>服务商可用性</h3>
            <div className="ledger">
              {providers.map((p) => (
                <div key={p.name} className="ledger-row diag-row">
                  <span>{p.name}</span>
                  <span className={"badge " + (p.available ? "ok" : "warn")}>
                    {p.available ? "在线" : "不可用"}</span>
                </div>
              ))}
            </div>
            <h3>任务落点</h3>
            <div className="ledger">
              {tasks.map((t) => (
                <div key={t.task} className="ledger-row diag-row">
                  <span>{t.label}</span>
                  <span className={"badge " + (t.active === "offline" ? "warn" : "ok")}>{t.active}</span>
                </div>
              ))}
            </div>
            <p className="muted small">详细 API 调用与降级记录见 knowledge_base/logs 目录（隐私分级脱敏）。</p>
          </div>
        )}

        {section === "ui" && (
          <div className="panel settings">
            <h3>主题</h3>
            <div className="controls">
              {([["dark", "深色"], ["light", "浅色"], ["system", "跟随系统"]] as const).map(([v, l]) => (
                <label key={v} className="chk">
                  <input type="radio" name="theme" checked={theme === v}
                         onChange={() => { setTheme(v); setThemePref(v); }} /> {l}
                </label>
              ))}
            </div>
            <p className="muted small">窗口标题栏随主题同步变色；导出的报告 HTML 固定纸感浅色（出版惯例）。</p>
            <h3>窗口</h3>
            <label className="chk">
              <input type="checkbox" checked={winMem}
                     onChange={(e) => {
                       setWinMem(e.target.checked);
                       localStorage.setItem("de.winmem", e.target.checked ? "on" : "off");
                       notify(e.target.checked
                         ? "已开启窗口记忆：下次启动恢复上次的位置与大小"
                         : "已关闭窗口记忆：下次启动回默认尺寸居中");
                     }} /> 记住窗口位置与大小（默认关闭）
            </label>
            <h3>面切换</h3>
            <label className="chk">
              <input type="checkbox" checked={gestureOn}
                     onChange={(e) => {
                       setGestureOn(e.target.checked);
                       localStorage.setItem("de.gesture", e.target.checked ? "on" : "off");
                     }} /> 启用长按右键滑动切面（滑动超过一定距离生效）
            </label>
            <label className="chk">
              <input type="checkbox" checked={gestureInv}
                     onChange={(e) => {
                       setGestureInv(e.target.checked);
                       localStorage.setItem("de.gesture.invert", e.target.checked ? "1" : "0");
                     }} /> 反转滑动方向（默认：向左滑 = 去右边的面）
            </label>
            <h3>快捷键</h3>
            <div className="param-row">
              <span>切换两面</span>
              <select value={keySwitch} onChange={(e) => saveSwitchKey(e.target.value)}>
                {["Ctrl+Tab", "Ctrl+Q", "Ctrl+E", "Ctrl+Shift+Tab", "Alt+Q"].map((k) =>
                  <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="param-row"><span>打开设置</span><code>{loadKeys().settings}</code></div>
            <div className="param-row"><span>命令面板（不可停用）</span><code>{loadKeys().palette}</code></div>
          </div>
        )}

        {section === "about" && (
          <div className="panel settings">
            <h3>软件信息</h3>
            <div className="param-row"><span>名称</span><span>Debate Engine（辩论引擎）</span></div>
            <div className="param-row"><span>版本</span><code>{version || "读取中…"}</code></div>
            <div className="param-row"><span>数据目录</span><span className="muted small">安装目录 knowledge_base/（文档、向量、日志、立场文件都在这里）</span></div>
            <p className="muted small">
              知识库为个人研究用途本地存储；分享包导出时强制剥离日志与 API Key。
              问题排查请附 knowledge_base/logs 下当日日志。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
