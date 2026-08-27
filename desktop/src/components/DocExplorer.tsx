// 馆藏中区文档浏览器（0.1.8 M1）：Windows 资源管理器习惯——
// 三态视图（图标网格/紧凑列表/详细信息表格）+ 排序（列头点击/下拉）+
// 待审灰显徽章（M2）。单击=档案卡、双击=阅读器、右键=G1 菜单。
// 视图态/排序 uiPrefs 持久化（libView/libSort）。
import { useMemo, useState } from "react";
import type { DocRow, StanceOpt } from "../App";
import { stanceLabel as _stanceLabel } from "../lib/stance";

export type LibView = "icons" | "list" | "details";
export type LibSort = "title" | "author" | "import" | "year";

interface Props {
  docs: DocRow[];
  stances: StanceOpt[];
  selectedId?: string;
  multiSel?: string[];                                 // 0.1.8 M6：Ctrl 多选集
  view: LibView;
  sort: LibSort;
  sortDesc: boolean;
  onSortChange: (sort: LibSort, desc: boolean) => void;
  onSelect: (doc: DocRow, e: React.MouseEvent) => void;
  onOpen: (doc: DocRow) => void;                       // 双击=阅读器
  onContext: (e: React.MouseEvent, doc: DocRow) => void;
}

const typeIcon = (d: DocRow): string => {
  const t = (d.source_type || "").toLowerCase();
  if (t.includes("pdf")) return "📄";
  if (t.includes("url") || t.includes("web")) return "🌐";
  if (t.includes("docx") || t.includes("word")) return "📝";
  if (t.includes("xls") || t.includes("csv")) return "📊";
  return "📃";
};

const cmp = (a: DocRow, b: DocRow, sort: LibSort): number => {
  switch (sort) {
    case "title":
      return (a.title || a.doc_id).localeCompare(b.title || b.doc_id, "zh-CN-u-co-pinyin");
    case "author":
      return String(a.author || "").localeCompare(String(b.author || ""), "zh-CN-u-co-pinyin");
    case "year":
      return (a.year ?? 0) - (b.year ?? 0);
    default:   // import
      return String(a.import_date || "").localeCompare(String(b.import_date || ""));
  }
};

const COLS: { key: LibSort | "stance" | "secondary_stance"; label: string }[] = [
  { key: "title", label: "标题" },
  { key: "author", label: "作者" },
  { key: "year", label: "年份" },
  { key: "stance", label: "立场" },
  { key: "secondary_stance", label: "次立场" },   // 0.1.9 R3
  { key: "import", label: "导入时间" },
];

export default function DocExplorer({
  docs, stances, selectedId, multiSel = [], view, sort, sortDesc,
  onSortChange, onSelect, onOpen, onContext,
}: Props) {
  const [colW, setColW] = useState<Record<string, number>>({});

  const sorted = useMemo(() => {
    const list = [...docs].sort((a, b) => cmp(a, b, sort));
    if (sortDesc) list.reverse();
    return list;
  }, [docs, sort, sortDesc]);

  const label = (k?: string) => _stanceLabel(k || "", stances);
  const pending = (d: DocRow) => d.review_status === "pending";
  const rowCls = (d: DocRow) =>
    (selectedId === d.doc_id || multiSel.includes(d.doc_id) ? " sel" : "")
    + (pending(d) ? " pending" : "");

  const headClick = (key: LibSort | "stance" | "secondary_stance") => {
    if (key === "stance" || key === "secondary_stance") return;   // 立场列不排序
    onSortChange(key, sort === key ? !sortDesc : false);
  };

  // 列宽拖拽（详细信息视图）
  const startDrag = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colW[key] ?? 140;
    const move = (ev: MouseEvent) => {
      setColW((prev) => ({ ...prev, [key]: Math.max(60, startW + ev.clientX - startX) }));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  if (docs.length === 0) return null;   // 空库引导由外层保留

  if (view === "details") {
    return (
      <div className="doc-explorer details" role="table">
        <div className="dx-head" role="row">
          {COLS.map((c) => (
            <span key={c.key} role="columnheader"
                  className={"dx-th" + (sort === c.key ? " on" : "")}
                  style={colW[c.key] ? { width: colW[c.key], flex: "none" } : undefined}
                  onClick={() => headClick(c.key)}>
              {c.label}
              {sort === c.key && <i className="dx-arrow">{sortDesc ? "▾" : "▴"}</i>}
              <i className="dx-resize" onMouseDown={(e) => startDrag(c.key, e)} />
            </span>
          ))}
        </div>
        {sorted.map((d) => (
          <div key={d.doc_id} className={"dx-row" + rowCls(d)} role="row"
               onClick={(e) => onSelect(d, e)} onDoubleClick={() => onOpen(d)}
               onContextMenu={(e) => { e.preventDefault(); onContext(e, d); }}>
            <span style={colW.title ? { width: colW.title, flex: "none" } : undefined}>
              {typeIcon(d)} {d.title || d.doc_id}
              {pending(d) && <em className="badge warn dx-badge">待审</em>}
            </span>
            <span style={colW.author ? { width: colW.author, flex: "none" } : undefined}>
              {String(d.author || "—")}</span>
            <span style={colW.year ? { width: colW.year, flex: "none" } : undefined}>
              {d.year ?? "—"}</span>
            <span style={colW.stance ? { width: colW.stance, flex: "none" } : undefined}>
              {label(d.stance)}</span>
            <span style={colW.secondary_stance ? { width: colW.secondary_stance, flex: "none" } : undefined}>
              {(d as any).secondary_stances && (d as any).secondary_stances.length > 0
                ? (d as any).secondary_stances.map((s: string) => label(s)).join(", ")
                : "—"}
            </span>
            <span style={colW.import ? { width: colW.import, flex: "none" } : undefined}>
              {String(d.import_date || "—").slice(0, 16)}</span>
          </div>
        ))}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="doc-explorer list">
        {sorted.map((d) => (
          <div key={d.doc_id} className={"dx-item" + rowCls(d)}
               onClick={(e) => onSelect(d, e)} onDoubleClick={() => onOpen(d)}
               onContextMenu={(e) => { e.preventDefault(); onContext(e, d); }}>
            <span className="dx-ico">{typeIcon(d)}</span>
            <span className="dx-title">{d.title || d.doc_id}</span>
            {pending(d) && <em className="badge warn dx-badge">待审</em>}
            <span className="muted small">{String(d.author || "")}</span>
          </div>
        ))}
      </div>
    );
  }

  // icons 视图（默认）：类型图标 + 两行标题网格
  return (
    <div className="doc-explorer icons">
      {sorted.map((d) => (
        <div key={d.doc_id} className={"dx-card" + rowCls(d)} title={d.summary || d.title}
             onClick={(e) => onSelect(d, e)} onDoubleClick={() => onOpen(d)}
             onContextMenu={(e) => { e.preventDefault(); onContext(e, d); }}>
          <span className="dx-ico-lg">{typeIcon(d)}</span>
          <span className="dx-name">{d.title || d.doc_id}</span>
          {pending(d) && <em className="badge warn dx-badge">待审</em>}
        </div>
      ))}
    </div>
  );
}
