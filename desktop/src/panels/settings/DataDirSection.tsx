// 0.1.4 批 5（决策 2）：数据目录展示 + 一键迁移（NDJSON 进度流）。
// 目标须为空目录；复制完成写 %APPDATA%\DebateEngine\data-root.txt，重启生效，旧目录保留。
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, engineBase } from "../../api";
import { askConfirm } from "../../components/AppDialog";

interface DataRoot {
  path: string; marker: string; overridden: boolean;
  old_path?: string; old_size_bytes?: number; old_rollback_ok?: boolean;
}

export default function DataDirSection({ notify }: { notify: (msg: string) => void }) {
  const [root, setRoot] = useState<DataRoot | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<DataRoot>("/api/config/data-root").then(setRoot).catch(() => {});
  }, []);

  const fmtSpeed = (bps: number) =>
    bps > 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;

  const migrate = async () => {
    const target = await openDialog({ title: "选择新的数据目录（须为空）", directory: true });
    if (!target || typeof target !== "string") return;
    setMigrating(true); setPct(0); setMsg("准备中…");
    try {
      const r = await fetch(`${engineBase()}/api/config/data-root/migrate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!r.ok) {
        const detail = (await r.json().catch(() => null))?.detail || r.status;
        throw new Error(String(detail));
      }
      if (!r.body) throw new Error("无响应流");
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
            notify(evt.detail);
            if (evt.ok) api.get<DataRoot>("/api/config/data-root").then(setRoot).catch(() => {});
          } else {
            if (typeof evt.percent === "number") setPct(evt.percent);
            if (evt.status) setMsg(evt.status);
            else if (typeof evt.speed_bps === "number") setMsg(`复制中 ${fmtSpeed(evt.speed_bps)}`);
          }
        }
      }
    } catch (e) { notify(`迁移失败: ${e}`); }
    finally { setMigrating(false); }
  };

  // 0.1.5 D5：回滚到旧目录（删标记回默认路径，需旧库在）
  const rollback = async () => {
    if (!(await askConfirm({ title: "回滚到旧目录？",
        body: `${root?.old_path}\n重启软件后生效；迁移后的目录保留不删。` }))) return;
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(
        "/api/config/data-root/rollback", {});
      notify(r.detail);
      api.get<DataRoot>("/api/config/data-root").then(setRoot).catch(() => {});
    } catch (e) { notify(`回滚失败: ${e}`); }
  };
  const fmtSize = (b: number) =>
    b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(0)} MB`;

  return (
    <>
      <h3>数据目录</h3>
      <div className="param-row">
        <span>当前位置{root?.overridden ? "（已迁移）" : ""}</span>
        <code className="small">{root?.path || "读取中…"}</code>
      </div>
      <p className="muted small">
        文档、向量、日志、立场文件都在此目录。迁移为整目录复制：
        新目录须为空；完成后重启软件生效，<b>旧目录保留</b>可随时回退。
      </p>
      <div className="controls">
        {migrating ? (
          <span className="pull-progress" title={msg}>
            <i style={{ width: `${pct}%` }} />
            <em>{pct}% {msg}</em>
          </span>
        ) : (
          <button onClick={migrate}>迁移到新目录…</button>
        )}
        {!migrating && root?.overridden && (
          <button disabled={!root.old_rollback_ok}
                  title={root.old_rollback_ok ? "" : "旧目录无 knowledge.db，不能回滚"}
                  onClick={rollback}>
            回滚到旧目录{root.old_size_bytes
              ? `（${fmtSize(root.old_size_bytes)}）` : ""}…</button>
        )}
      </div>
      {root?.overridden && root.old_path && (
        <p className="muted small">旧目录：{root.old_path}</p>
      )}
    </>
  );
}
