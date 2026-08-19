// 档案浏览（0.1.5 D4）：馆藏「档案」投影——树=立场→作者→文件（读 archive 目录），
// md 点开右侧正文预览；原件提示用资源管理器打开。复用 DocTree 展收范式。
import { useEffect, useState } from "react";
import { api } from "../api";

interface AFile { name: string; rel: string; md: boolean }
interface AAuthor { author: string; files: AFile[] }
interface ANode { stance: string; authors: AAuthor[] }

export default function ArchiveView({ active, notify }: {
  active: boolean;
  notify: (msg: string) => void;
}) {
  const [tree, setTree] = useState<ANode[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<{ rel: string; markdown: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!active || loaded) return;
    api.get<{ tree: ANode[] }>("/api/knowledge/archive/tree")
      .then((r) => { setTree(r.tree); setLoaded(true); })
      .catch((e) => notify(`读取档案库失败: ${e}`));
  }, [active, loaded, notify]);

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const openFile = async (f: AFile) => {
    if (!f.md) { notify("原件请在档案目录用资源管理器打开"); return; }
    try {
      const r = await api.get<{ rel: string; markdown: string }>(
        `/api/knowledge/archive/file?rel=${encodeURIComponent(f.rel)}`);
      setCur(r);
    } catch (e) { notify(`打开失败: ${e}`); }
  };

  return (
    <div className="coll-split archive-view">
      <aside className="coll-tree">
        <div className="tree-head">
          <span className="muted small">档案库（人可读 md + 原件）</span>
          <button className="link" onClick={() => setLoaded(false)}>刷新</button>
        </div>
        {tree.length === 0 && (
          <div className="empty-state"><p>档案库为空——导入时选「复制/迁移进档案库」即会归档</p></div>
        )}
        {tree.map((s) => (
          <div key={s.stance}>
            <div className="tree-node" onClick={() => toggle(s.stance)}>
              {open[s.stance] ? "▾" : "▸"} {s.stance}
            </div>
            {open[s.stance] && s.authors.map((a) => {
              const ak = `${s.stance}/${a.author}`;
              return (
                <div key={ak} className="tree-sub">
                  {a.author && (
                    <div className="tree-node" onClick={() => toggle(ak)}>
                      {open[ak] ? "▾" : "▸"} {a.author}
                    </div>
                  )}
                  {(!a.author || open[ak]) && a.files.map((f) => (
                    <div key={f.rel}
                         className={"tree-leaf" + (cur?.rel === f.rel ? " on" : "")
                                    + (f.md ? "" : " muted")}
                         title={f.md ? "" : "原件（资源管理器打开）"}
                         onClick={() => openFile(f)}>
                      {f.name}
                    </div>
                  ))}
                </div>
              );
            })}
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
