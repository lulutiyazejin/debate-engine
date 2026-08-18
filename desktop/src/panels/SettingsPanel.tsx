// 设置面板（项目13）：服务商 API Key 配置（不回显明文）+ 保存即热重载
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Provider {
  name: string;
  configured: boolean;
  available: boolean;
  model?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq（免费额度大，反驳生成快）",
  gemini: "Google Gemini（大窗口，适合全书摘要）",
  cerebras: "Cerebras（免费高速）",
  mistral: "Mistral（免费额度）",
  openrouter: "OpenRouter（聚合入口）",
  ollama: "Ollama（本机离线模型，无需 Key）",
};

export default function SettingsPanel({ notify }: { notify: (msg: string) => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.get<{ providers: Provider[] }>("/api/config/providers")
      .then((r) => setProviders(r.providers))
      .catch((e) => notify(`读取配置失败: ${e}`));
  }, [notify]);

  useEffect(refresh, [refresh]);

  const save = async (provider: string) => {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/config/key", { provider, key: keyInput.trim() });
      notify("已保存并热重载（无需重启）");
      setEditing(null);
      setKeyInput("");
      refresh();
    } catch (e) {
      notify(`保存失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider: string) => {
    if (!window.confirm(`移除 ${provider} 的 Key？`)) return;
    try {
      await api.del(`/api/config/key/${provider}`);
      notify("已移除");
      refresh();
    } catch (e) {
      notify(`移除失败: ${e}`);
    }
  };

  return (
    <div className="panel settings">
      <h3>模型服务商</h3>
      <p className="muted small">
        全部选用免费额度服务商；不配置任何 Key 时进入离线模式（仅检索，不生成）。
        Key 保存在本机 .env 文件，不会上传。
      </p>
      <div className="provider-list">
        {providers.map((p) => (
          <div key={p.name} className="provider-card">
            <div className="provider-head">
              <b>{PROVIDER_LABELS[p.name] || p.name}</b>
              <span className={"badge " + (p.available ? "ok" : p.configured ? "warn" : "")}>
                {p.available ? "可用" : p.configured ? "已配置（暂不可用）" : "未配置"}
              </span>
            </div>
            {p.model && <div className="muted small">默认模型：{p.model}</div>}
            {p.name === "ollama" ? null : editing === p.name ? (
              <div className="controls">
                <input className="key-input" type="password" value={keyInput}
                       placeholder="粘贴 API Key"
                       onChange={(e) => setKeyInput(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && save(p.name)} />
                <button className="primary" disabled={busy || !keyInput.trim()}
                        onClick={() => save(p.name)}>保存</button>
                <button onClick={() => { setEditing(null); setKeyInput(""); }}>取消</button>
              </div>
            ) : (
              <div className="controls">
                <button onClick={() => { setEditing(p.name); setKeyInput(""); }}>
                  {p.configured ? "更换 Key" : "填入 Key"}
                </button>
                {p.configured &&
                  <button className="danger-btn" onClick={() => remove(p.name)}>移除</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <h3>知识文件</h3>
      <p className="muted small">
        反驳风格（styles.md）、谬误表（fallacies.md）、坐标中心点（centers.md）都是
        知识库 skills 目录下的普通 Markdown，可直接用任何编辑器修改，保存后下次生成即生效。
      </p>
    </div>
  );
}
