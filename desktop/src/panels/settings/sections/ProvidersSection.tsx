// 设置·模型服务商分区（0.1.5 B1 拆分自 SettingsPanel）：
// 内置服务商卡（Key/换模型/连通测试）+ 自定义服务商（OpenAI 兼容）。
import { useState } from "react";
import { api } from "../../../api";
import type { TaskRow } from "./TasksSection";

export interface Provider { name: string; configured: boolean; available: boolean; model?: string }
export interface CustomProv { name: string; url: string; model: string; tasks: string[]; has_key: boolean }

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq（免费额度大，反驳生成快）",
  gemini: "Google Gemini（大窗口，适合全书摘要）",
  cerebras: "Cerebras（免费高速）",
  mistral: "Mistral（免费额度）",
  openrouter: "OpenRouter（聚合入口）",
  ollama: "Ollama（本机离线模型，无需 Key）",
};

interface Props {
  providers: Provider[];
  tasks: TaskRow[];
  customs: CustomProv[];
  notify: (msg: string) => void;
  onChanged: () => void;
}

export default function ProvidersSection({ providers, tasks, customs,
                                           notify, onChanged }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [cp, setCp] = useState({ name: "", url: "", key: "", model: "", tasks: [] as string[] });
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [overrideEdit, setOverrideEdit] = useState<string | null>(null);
  const [overrideModel, setOverrideModel] = useState("");

  const saveKey = async (provider: string) => {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/config/key", { provider, key: keyInput.trim() });
      notify("已保存并热重载（无需重启）");
      setEditing(null); setKeyInput(""); onChanged();
    } catch (e) { notify(`保存失败: ${e}`); } finally { setBusy(false); }
  };

  const removeKey = async (provider: string) => {
    if (!window.confirm(`移除 ${provider} 的 Key？`)) return;
    try { await api.del(`/api/config/key/${provider}`); notify("已移除"); onChanged(); }
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
      setOverrideEdit(null); setOverrideModel(""); onChanged();
    } catch (e) { notify(`修改失败: ${e}`); }
  };

  const addCustom = async () => {
    if (!cp.name || !cp.url || !cp.model) { notify("名称 / BaseURL / 模型名必填"); return; }
    try {
      await api.post("/api/config/custom-providers", cp);
      notify(`自定义服务商 ${cp.name} 已加入，可到「任务分工」设为选用`);
      setCp({ name: "", url: "", key: "", model: "", tasks: [] });
      onChanged();
    } catch (e) { notify(`添加失败: ${e}`); }
  };

  const delCustom = async (name: string) => {
    if (!window.confirm(`移除自定义服务商 ${name}？曾选用它的任务将回落内置默认。`)) return;
    try { await api.del(`/api/config/custom-providers/${name}`); notify("已移除"); onChanged(); }
    catch (e) { notify(`移除失败: ${e}`); }
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
          .map((t) => t.label).join("、") || "—"}
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
    <>
      <h3>内置服务商</h3>
      <p className="muted small">Key 保存在本机 .env，不上传；保存后热重载无需重启。</p>
      <div className="provider-list">{providers.map(provCard)}</div>
      <h3>自定义服务商（OpenAI 兼容）</h3>
      {customs.map((c) => (
        <div key={c.name} className="provider-card">
          <div className="provider-head"><b>{c.name}</b>
            <span className="muted small">{c.model} @ {c.url}</span></div>
          <div className="muted small">承担任务：{tasks.filter((t) => t.chain.includes(c.name))
            .map((t) => t.label).join("、") || "—"}</div>
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
          <span className="muted small">立即承担任务（可空，添加后也可到任务分工调整）：</span>
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
    </>
  );
}
