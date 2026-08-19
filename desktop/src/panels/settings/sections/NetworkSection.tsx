// 设置·网络与代理分区（0.1.5 B1 拆分自 SettingsPanel）：
// 代理三态 + 联网补充元数据开关 + 连通自测。
import { useEffect, useState } from "react";
import { api } from "../../../api";

interface CheckRow { item: string; ok: boolean; detail: string }

interface Props {
  notify: (msg: string) => void;
  tick: number;
}

export default function NetworkSection({ notify, tick }: Props) {
  const [proxy, setProxy] = useState<{ mode: string; url: string }>({ mode: "off", url: "" });
  const [proxyUrl, setProxyUrl] = useState("");
  const [webEnrich, setWebEnrich] = useState(true);
  const [checks, setChecks] = useState<CheckRow[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.get<{ mode: string; url: string }>("/api/config/proxy")
      .then((r) => { setProxy(r); setProxyUrl(r.url); }).catch(() => {});
    api.get<{ enabled: boolean }>("/api/config/web-enrich")
      .then((r) => setWebEnrich(r.enabled)).catch(() => {});
  }, [tick]);

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

  return (
    <>
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
    </>
  );
}
