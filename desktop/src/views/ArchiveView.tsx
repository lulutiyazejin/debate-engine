// 档案浏览 (0.1.5 D4)：馆藏「档案」投影——树 = 立场→作者→文件 (读 archive 目录)，
// 0.1.9 D2: stance label 映射 + 头部说明
import { useEffect, useState } from "react";
import { api } from "../api";
import { stanceLabel } from "../lib/stance";
import type { StanceOpt } from "../App";

interface AFile { name: string; rel: string; md?: boolean; original?: string }
interface AAuthor { author: string; files: AFile[] }
interface ANode { stance: string; authors: AAuthor[] }

export default function ArchiveView({ active, notify, stances }: {
  active: boolean;
  notify: (msg: string) => void;
  stances: StanceOpt[];
}) {
  const [tree, setTree] = useState<ANode[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<{ rel: string; markdown: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const openExplorer = (path: string) => {
    // @ts-ignore
    try { window.tauri?.invoke("open", { path }); } catch { /* 忽略 */ }
  };

  useEffect(() => {
    if (!active || loaded) return;
    api.get<{ tree: ANode[] }>("/api/knowledge/archive/tree")
      .then((r) => { setTree(r.tree); setLoaded(true); })
      .catch((e) => notify(`读取档案库失败：${e}`));
  }, [active, loaded, notify]);

  const toggle = (key: string) => {
    const next = { ...open };
    next[key] = !next[key];
    setOpen(next);
  };

  const openFile = async (f: any) => {
    try {
      const r = await api.get<{ rel: string; markdown: string }>(
        `/api/knowledge/archive/file?rel=${encodeURIComponent(f.rel)}`);
      setCur(r);
    } catch (e) { notify(`打开失败：${e}`); }
  };

  return (
    <div className="coll-split archive-view">
      <aside className="coll-tree">
        <div className="tree-head">
          <span className="muted small">档案库 = 磁盘上的人可读备份（md + 原件），与馆藏文档一一对应</span>
          <button className="link" onClick={() => setLoaded(false)}>刷新</button>
        </div>
        {tree.length === 0 && (
          <div className="empty-state"><p>档案库为空——导入时选「复制/迁移进档案库」即会归档</p></div>
        )}
        {tree.map((s) => (
          <div key={s.stance}>
            <div className="tree-node" onClick={() => toggle(s.stance)}>
              {open[s.stance] ? "▾" : "▸"} {stanceLabel(s.stance, stances)}
            </div>
            <div className="tree-sub">
              {s.authors.map((a) => {
                const ak = `${s.stance}/${a.author}`;
                return (
                  <div key={ak}>
                    <div className="tree-node" onClick={() => toggle(ak)}>
                      {open[ak] ? "▾" : "▸"} {a.author}
                    </div>
                    {(!a.author || open[ak]) && [
                      ...a.files.filter(f => f.md) as any,
                      ...a.files.filter(f => f.original) as any
                    ].map((f: any) => (
                      <div key={f.original || f.rel} className={`tree-leaf${cur?.rel === (f.rel as string) ? " on" : ""}`}
                           title={f.original ? "在资源管理器中打开" : "Markdown 预览"}
                           onClick={() => f.original ? openExplorer(f.original) : openFile(f)}>
                        <span>{f.name}</span>
                        {f.original && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l2-2H5a2 2 0 00-2 2z"></path>
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </aside>
      <div className="coll-main archive-body">
        {cur
          ? <pre className="md-preview pad">{cur.markdown}</pre>
          : <div className="empty-state"><p>左侧选择一份 md 档案查看</p></div>}
      </div>
    </div>
  );
}
