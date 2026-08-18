// 设置面板（项目13/14）：服务商 Key 配置 + 知识库导出/导入/备份
import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
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
  const [kbBusy, setKbBusy] = useState(false);

  const exportKb = async () => {
    const path = await save({
      title: "导出知识库分享包",
      defaultPath: "debate-kb.debkb",
      filters: [{ name: "知识库包", extensions: ["debkb"] }],
    });
    if (!path) return;
    setKbBusy(true);
    try {
      const r = await api.post<{ documents: number; size_bytes: number }>(
        "/api/kb/export", { path, include_vectors: true });
      notify(`导出完成：${r.documents} 文档，${(r.size_bytes / 1048576).toFixed(1)} MB`);
    } catch (e) {
      notify(`导出失败: ${e}`);
    } finally {
      setKbBusy(false);
    }
  };

  const importKb = async () => {
    const path = await open({
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
    } catch (e) {
      notify(`导入失败: ${e}`);
    } finally {
      setKbBusy(false);
    }
  };

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
      <h3>知识库分享与备份</h3>
      <p className="muted small">
        导出包含：文档元数据、全部分块文本、向量、知识文件；
        <b>强制剥离日志与 API Key</b>。备份可直接导出到网盘同步文件夹。
        接收方嵌入模型版本不一致时，用包内文本自动重建向量。
      </p>
      <div className="controls">
        <button className="primary" disabled={kbBusy} onClick={exportKb}>导出全库…</button>
        <button disabled={kbBusy} onClick={importKb}>导入分享包…</button>
        {kbBusy && <span className="muted small">处理中…</span>}
      </div>
      <h3>知识文件</h3>
      <p className="muted small">
        反驳风格（styles.md）、谬误表（fallacies.md）、坐标中心点（centers.md）都是
        知识库 skills 目录下的普通 Markdown，可直接用任何编辑器修改，保存后下次生成即生效。
      </p>
    </div>
  );
}
