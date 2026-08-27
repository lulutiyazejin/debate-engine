// 0.1.7 项 11:字体管理(PLAN-0.1.7 批 6)。
// 推荐字体在线下载(NDJSON 进度+断点续传)/本地导入/删除;下载与导入成功后
// 重跑 initExternalFonts 热生效(项 13 canvas 同步受益);删除后刷新回落系统栈。
import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, engineBase } from "../../../api";
import { ndjsonPost } from "../../../lib/ndjson";
import { initExternalFonts } from "../../../theme";
import { askConfirm } from "../../../components/AppDialog";

const RECOMMENDED_FALLBACK = [
  { key: "noto-sans-sc", label: "思源黑体 SC", note: "中文正文首选（OFL）", installed: false },
  { key: "ibm-plex-mono", label: "IBM Plex Mono", note: "等宽数字/代码（OFL）", installed: false },
  { key: "inter", label: "Inter", note: "西文 UI 常用（OFL）", installed: false },
];

interface RecFont { key: string; label: string; note: string; installed: boolean }

interface Props { notify: (msg: string) => void; tick: number }

export default function FontSection({ notify, tick }: Props) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [rec, setRec] = useState<RecFont[]>(RECOMMENDED_FALLBACK);
  const [downloading, setDownloading] = useState("");
  const [pct, setPct] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");

  const refresh = useCallback(() => {
    api.get<{ fonts: string[] }>("/api/fonts")
      .then((r) => setFonts(r.fonts)).catch(() => {});
    // 0.1.8 S4：推荐清单带 installed 状态（后端与已装文件比对）
    api.get<{ fonts: RecFont[] }>("/api/fonts/recommended")
      .then((r) => setRec(r.fonts)).catch(() => {});
  }, []);
  useEffect(refresh, [refresh, tick]);

  // 热生效:重跑 FontFace 注册(theme.ts D12),canvas 经 fonts.ready 自动重绘
  const applyHot = () => { initExternalFonts(engineBase()).catch(() => {}); };

  const downloadFont = async (key: string, force = false) => {
    if (downloading) return;
    setDownloading(key); setPct(0); setProgressMsg("连接中…");
    try {
      await ndjsonPost("/api/fonts/download", { key, force }, (evt: {
        done?: boolean; ok?: boolean; detail?: string;
        percent?: number; status?: string; done_bytes?: number;
        speed_bps?: number;
      }) => {
        if (evt.done) {
          notify(evt.ok ? `${evt.detail}` : `下载失败：${evt.detail}`);
          if (evt.ok) { refresh(); applyHot(); }
        } else {
          if (typeof evt.percent === "number") setPct(evt.percent);
          if (evt.status) setProgressMsg(evt.status);
        }
      });
    } catch (e) { notify(`下载失败：${e}`); }
    finally { setDownloading(""); }
  };

  const importFont = async () => {
    const p = await openDialog({ multiple: false, filters: [
      { name: "字体文件", extensions: ["ttf", "otf", "woff", "woff2"] }] });
    if (typeof p !== "string") return;
    try {
      const r = await api.post<{ ok: boolean; detail?: string }>(
        "/api/fonts/import", { path: p });
      notify(r.detail || "已导入");
      if (r.ok) { refresh(); applyHot(); }
    } catch (e) { notify(`导入失败：${e}`); }
  };

  const deleteFont = async (name: string) => {
    if (!(await askConfirm({ title: `删除字体「${name}」？`,
        body: "删除后回落系统字体栈，刷新页面完全生效。", danger: true }))) return;
    try {
      await api.del(`/api/fonts/${encodeURIComponent(name)}`);
      notify("已删除，刷新页面后回落系统字体");
      refresh();
    } catch (e) { notify(`删除失败：${e}`); }
  };

  return (
    <>
      <h3>字体管理</h3>
      <p className="muted small">
        外挂字体不随安装包分发（体积红线）；下载/导入即热生效（含 3D 立方与图谱
        画布标签），删除后回落系统字体栈。存放于 knowledge_base/fonts。
      </p>

      <h4>推荐字体（OFL 开源许可，走「网络与代理」设置）</h4>
      {rec.map((f) => (
        <div className="param-row" key={f.key}>
          <span>{f.label} <span className="muted small">{f.note}</span></span>
          {f.installed && downloading !== f.key ? (
            <span className="controls" style={{ gap: 8 }}>
              <span className="muted small">已下载 ✓</span>
              <button className="link" disabled={!!downloading}
                      onClick={() => downloadFont(f.key, true)}>重新下载</button>
            </span>
          ) : (
            <button className="btn" disabled={!!downloading}
                    onClick={() => downloadFont(f.key)}>
              {downloading === f.key
                ? `${pct}% · ${progressMsg}` : "一键下载"}
            </button>
          )}
        </div>
      ))}

      <h4>本地导入</h4>
      <div className="param-row">
        <span className="muted small">支持 ttf / otf / woff / woff2</span>
        <button className="btn" onClick={importFont}>选择字体文件…</button>
      </div>

      <h4>已安装字体</h4>
      {fonts.length === 0 ? (
        <p className="muted small">暂无外挂字体（当前使用系统字体栈）</p>
      ) : fonts.map((name) => (
        <div className="param-row" key={name}>
          <code className="small">{name}</code>
          <button className="btn" onClick={() => deleteFont(name)}>删除</button>
        </div>
      ))}
    </>
  );
}
