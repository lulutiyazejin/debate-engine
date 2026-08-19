// 可搜选择器（0.1.4 批 2/项目 23）：输入即滤（子串/拼音首字母）+ 命中高亮 +
// 窗口化长列表 + 键盘流（↑↓/Enter/Esc）。文档/立场选择统一走此组件。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fuzzyRanges } from "../lib/fuzzy";

export interface CbxOption {
  value: string;
  label: string;
  sub?: string;        // 副行（作者/立场等），参与匹配
}

/** 命中高亮：匹配区间标 accent（候选与检索结果共用 .hl 样式） */
export function Hl({ text, query }: { text: string; query: string }): ReactNode {
  const ranges = query.trim() ? fuzzyRanges(text, query) : [];
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  const chars = [...text];
  for (const [s, e] of ranges) {
    if (s > last) out.push(chars.slice(last, s).join(""));
    out.push(<mark key={s} className="hl">{chars.slice(s, e).join("")}</mark>);
    last = e;
  }
  if (last < chars.length) out.push(chars.slice(last).join(""));
  return <>{out}</>;
}

const ITEM_H = 30;     // 窗口化行高
const VIEW_N = 9;      // 可视行数

interface Props {
  options: CbxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  scopeLabel?: string;             // 「已搜范围」提示（无匹配时显示）
  onView?: (value: string) => void; // 选中项旁「查看」小钮（开右栏档案卡）
}

export default function Combobox({ options, value, onChange, placeholder,
                                   width = 220, scopeLabel, onView }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return options;
    return options.filter((o) =>
      fuzzyRanges(o.label, query) !== null ||
      (o.sub && fuzzyRanges(o.sub, query) !== null));
  }, [options, q]);

  useEffect(() => { setActive(0); setScrollTop(0); if (listRef.current) listRef.current.scrollTop = 0; }, [q, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // 点外关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };

  const ensureVisible = (idx: number) => {
    const el = listRef.current;
    if (!el) return;
    const top = idx * ITEM_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ITEM_H > el.scrollTop + VIEW_N * ITEM_H)
      el.scrollTop = top + ITEM_H - VIEW_N * ITEM_H;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => { const n = Math.min(a + 1, filtered.length - 1); ensureVisible(n); return n; });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => { const n = Math.max(a - 1, 0); ensureVisible(n); return n; });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].value);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();   // 先关弹层，不透传给设置浮层
      setOpen(false);
    }
  };

  // 窗口化：只渲染可视区 ± 缓冲
  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ITEM_H) - 3);
  const end = Math.min(total, start + VIEW_N + 6);

  return (
    <div className="cbx" ref={wrapRef} style={{ width }}>
      <button type="button" className="cbx-field" onClick={() => setOpen(!open)}>
        <span className={"cbx-value" + (selected ? "" : " muted")}>
          {selected ? selected.label : (placeholder || "（选择）")}
        </span>
        <span className="cbx-caret">▾</span>
      </button>
      {selected && onView && (
        <button type="button" className="link cbx-view" title="查看档案卡"
                onClick={() => onView(selected.value)}>查看</button>
      )}
      {open && (
        <div className="cbx-pop">
          <input ref={inputRef} value={q} placeholder="输入过滤：标题 / 作者 / 拼音首字母"
                 onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <div className="cbx-list" ref={listRef} style={{ maxHeight: VIEW_N * ITEM_H }}
               onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
            {total === 0 ? (
              <div className="cbx-empty muted small">
                无匹配{scopeLabel ? `（已搜范围：${scopeLabel}）` : ""}
              </div>
            ) : (
              <div style={{ height: total * ITEM_H, position: "relative" }}>
                {filtered.slice(start, end).map((o, i) => {
                  const idx = start + i;
                  return (
                    <div key={o.value || "__empty"}
                         className={"cbx-item" + (idx === active ? " active" : "")
                           + (o.value === value ? " sel" : "")}
                         style={{ position: "absolute", top: idx * ITEM_H, height: ITEM_H,
                                  left: 0, right: 0 }}
                         onMouseEnter={() => setActive(idx)}
                         onClick={() => pick(o.value)}>
                      <span className="cbx-label"><Hl text={o.label} query={q} /></span>
                      {o.sub && <span className="cbx-sub"><Hl text={o.sub} query={q} /></span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
