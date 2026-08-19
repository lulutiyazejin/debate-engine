// 馆藏文档树（0.1.4 批 2/项目 22）：立场分组 + 组头折叠（记忆）+ 树内过滤 +
// 外部选中自动展开滚到可见。从 LibraryFace 常驻左栏迁入馆藏主从布局。
import { useEffect, useMemo, useState } from "react";
import type { DocRow, StanceOpt } from "../App";
import { Hl } from "./Combobox";
import { fuzzyMatch } from "../lib/fuzzy";

const FOLD_KEY = "de.treefold";

function loadFold(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); }
  catch { return new Set(); }
}

interface Props {
  docs: DocRow[];
  stances: StanceOpt[];
  stats: Record<string, number>;
  selectedId?: string;
  onSelect: (doc: DocRow) => void;
  onContext: (e: React.MouseEvent, doc: DocRow) => void;
}

export default function DocTree({ docs, stances, stats, selectedId,
                                  onSelect, onContext }: Props) {
  const [fold, setFold] = useState<Set<string>>(loadFold);
  const [filter, setFilter] = useState("");

  const stanceLabel = (key: string) =>
    stances.find((s) => s.name === key)?.label || key || "未分类";

  const groups = useMemo(() => {
    const g = new Map<string, DocRow[]>();
    for (const d of docs) {
      if (filter && !fuzzyMatch(filter, d.title, d.author as string | undefined)) continue;
      const k = d.stance || "";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(d);
    }
    return g;
  }, [docs, filter]);

  const saveFold = (next: Set<string>) => {
    setFold(next);
    localStorage.setItem(FOLD_KEY, JSON.stringify([...next]));
  };

  const toggle = (st: string) => {
    const next = new Set(fold);
    if (next.has(st)) next.delete(st); else next.add(st);
    saveFold(next);
  };

  // 外部跳转选中 → 所在组自动展开并滚到可见（决策 20）
  useEffect(() => {
    if (!selectedId) return;
    const doc = docs.find((d) => d.doc_id === selectedId);
    if (!doc) return;
    const st = doc.stance || "";
    if (fold.has(st)) saveFold(new Set([...fold].filter((x) => x !== st)));
    // 等展开后的下一帧再滚
    requestAnimationFrame(() => {
      document.querySelector(`[data-doc="${selectedId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, docs]);

  return (
    <div className="doc-tree">
      {/* 紧凑统计条（原三大数字头收编，决策 20） */}
      <div className="tree-head">
        <span className="caps">馆藏</span>
        <span className="muted small">
          {stats.documents ?? 0} 档 · {stats.chunks ?? 0} 块 · {stats.arg_units ?? 0} 论证
        </span>
      </div>
      <div className="tree-tools">
        <input value={filter} placeholder="过滤：标题 / 作者 / 拼音首字母"
               onChange={(e) => setFilter(e.target.value)} />
        <button className="link" title="全部展开"
                onClick={() => saveFold(new Set())}>展</button>
        <button className="link" title="全部收起"
                onClick={() => saveFold(new Set([...groups.keys()]))}>收</button>
      </div>
      <div className="tree">
        {docs.length === 0 && (
          <div className="empty-state small">
            <p>知识库还是空的</p>
            <p className="muted small">把文件拖进右侧导入区即可入库</p>
          </div>
        )}
        {[...groups.entries()].map(([st, list]) => {
          const folded = fold.has(st);
          return (
            <div key={st || "none"} className="tree-group">
              <div className="tree-stance" onClick={() => toggle(st)}>
                <svg width="10" height="10" viewBox="0 0 10 10"
                     style={{ transform: folded ? "rotate(-90deg)" : "none" }}>
                  <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor"
                        strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <i className="stance-dot" data-stance={st} />
                {stanceLabel(st)} <span className="muted">({list.length})</span>
              </div>
              {!folded && list.map((d) => (
                <div key={d.doc_id} data-doc={d.doc_id}
                     className={"tree-doc" + (selectedId === d.doc_id ? " sel" : "")}
                     title={d.summary || ""}
                     onClick={() => onSelect(d)}
                     onContextMenu={(e) => { e.preventDefault(); onContext(e, d); }}>
                  <Hl text={d.title || d.doc_id} query={filter} />
                  {(d as { origin?: string }).origin === "self" && <span className="self-tag">自产</span>}
                </div>
              ))}
            </div>
          );
        })}
        {docs.length > 0 && groups.size === 0 && (
          <div className="empty-state small"><p>无匹配（已搜范围：标题/作者/拼音首字母）</p></div>
        )}
      </div>
    </div>
  );
}
