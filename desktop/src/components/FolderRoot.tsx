// 0.1.9 L1:馆藏文件夹视图——根层立场导航，二层文档列表（基于 DocExplorer）
// 0.1.9 L3：面包屑上提至工具条（受控 crumbStance）；过滤词作用于根层文件夹 / 文档层。
import { useMemo } from "react";
import type { DocRow, StanceOpt } from "../App";
import DocExplorer, { type LibSort, type LibView } from "./DocExplorer";

interface Props {
  docs: DocRow[];
  stances: StanceOpt[];
  selectedId?: string;
  multiSel?: string[];
  view: LibView;
  sort: LibSort;
  sortDesc: boolean;
  crumbStance: string | null;               // 0.1.9 L3：受控当前文件夹（null=根层）
  filter?: string;                           // 0.1.9 L3：过滤词（标题/作者/立场名）
  onCrumbChange: (stance: string | null) => void;
  onSortChange: (sort: LibSort, desc: boolean) => void;
  onSelect: (doc: DocRow, e: React.MouseEvent) => void;
  onOpen: (doc: DocRow) => void;
  onContext: (e: React.MouseEvent, doc: DocRow) => void;
}

export default function FolderRoot({ docs, stances, selectedId, multiSel, view, sort, sortDesc,
  crumbStance, filter = "", onCrumbChange, onSortChange, onSelect, onOpen, onContext }: Props) {
  const f = filter.trim().toLowerCase();

  const folders = useMemo(() => {
    const m = new Map<string, { total: number; pending: number }>();
    for (const d of docs) {
      const k = d.stance || "";
      const row = m.get(k) || { total: 0, pending: 0 };
      row.total += 1;
      if (d.review_status === "pending") row.pending += 1;
      m.set(k, row);
    }
    const all = [...m.entries()].map(([stance, { total, pending }]) => ({
      stance_label: stances.find(s => s.name === stance)?.label || stance || "未分类",
      count: total, pending, stance,
    })).sort((a, b) => a.stance_label.localeCompare(b.stance_label, "zh-CN"));
    // L3 过滤：根层按文件夹名过滤
    return f ? all.filter(x => x.stance_label.toLowerCase().includes(f)) : all;
  }, [docs, stances, f]);

  // L3 过滤：文档层按标题/作者过滤
  const stanceDocs = useMemo(() => {
    let ds = crumbStance != null ? docs.filter(d => (d.stance || "") === crumbStance) : [];
    if (f) ds = ds.filter(d => (d.title || "").toLowerCase().includes(f)
                             || (d.author || "").toLowerCase().includes(f));
    return ds;
  }, [docs, crumbStance, f]);

  return (
    <div className="lib-center folder-root">
      {crumbStance != null ? (
        <DocExplorer docs={stanceDocs} stances={stances} selectedId={selectedId} multiSel={multiSel}
                     view={view} sort={sort} sortDesc={sortDesc}
                     onSortChange={onSortChange} onSelect={onSelect} onOpen={onOpen} onContext={onContext} />
      ) : (
        <div className="folder-grid pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {folders.map(fd => (
            <div key={fd.stance} className="folder-card"
                 style={{ border: `1px solid var(--tx-5)`, borderRadius: 6, padding: 12, cursor: "pointer" }}
                 onClick={() => onCrumbChange(fd.stance)}
                 onMouseOver={e => { e.currentTarget.style.borderColor = "var(--primary)"; }}
                 onMouseOut={e => { e.currentTarget.style.borderColor = "var(--tx-5)"; }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{fd.stance_label}</div>
              <div className="small muted">{fd.count} 篇文献{fd.pending > 0 ? ` · ${fd.pending} 待审` : ""}</div>
            </div>
          ))}
          {folders.length === 0 && (
            <div className="muted small" style={{ gridColumn: "1 / -1" }}>没有匹配「{filter}」的文件夹</div>
          )}
        </div>
      )}
    </div>
  );
}
