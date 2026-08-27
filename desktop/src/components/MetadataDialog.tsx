// 元数据编辑对话框（0.1.8 M3）：标题/作者/年份/立场表单。
// 0.1.9 D1: 年份接受完整日期（ISO/紧凑戳），双存 year+year_raw。
// PATCH /metadata（字段）+ PATCH /stance（立场，六处数据同步走 indexer）。
// M2 审核卡复用同表单（嵌入模式 embedded）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { parseDateInput } from "../lib/dates";
import type { DocRow, StanceOpt } from "../App";

interface Props {
  doc: DocRow;
  stances: StanceOpt[];
  notify: (msg: string) => void;
  onClose: () => void;
  onSaved: () => void;
}

export default function MetadataDialog({ doc, stances, notify, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(doc.title || "");
  const [author, setAuthor] = useState(String(doc.author || ""));
  const [year, setYear] = useState(doc.year ? String(doc.year) : "");
  const [stance, setStance] = useState(doc.stance || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    // 0.1.9 D1: parseDateInput 解析完整日期；失败则允许空且保留手动整数校验
    let y: number | null = null;
    let yr: string | null = null;
    if (year.trim()) {
      const pd = parseDateInput(year.trim());
      if (pd.ok) {
        y = pd.year ?? null;
        yr = pd.raw;
        if (y !== null && (y < -3000 || y > 2600)) {
          notify("年份超出合理范围（-3000 ~ 2600）");
          return;
        }
      } else {
        // 非格式命中 → 尝试当纯数字年（兼容旧习惯）
        const rawInt = Number(year.trim());
        if (!Number.isFinite(rawInt) || !Number.isInteger(rawInt) || rawInt < -3000 || rawInt > 2600) {
          notify("年份需为 -3000 ~ 2600 的整数或完整日期（如 2026-05-01 12:01:37）");
          return;
        }
        y = Math.round(rawInt);
        yr = year.trim();
      }
    }
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      if (title.trim() && title.trim() !== (doc.title || "")) fields.title = title.trim();
      if (author.trim() !== String(doc.author || "")) fields.author = author.trim();
      if (y !== null && y !== doc.year) {
        fields.year = y;
        if (yr) fields.year_raw = yr;  // 0.1.9 D1
      }
      if (Object.keys(fields).length) {
        await api.patch(`/api/knowledge/docs/${doc.doc_id}/metadata`, fields);
      }
      if (stance && stance !== doc.stance) {
        await api.patch(`/api/knowledge/docs/${doc.doc_id}/stance`, { stance });
      }
      notify("元数据已保存");
      onSaved();
      onClose();
    } catch (e) {
      notify(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="reader-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}
           style={{ width: 420 }}>
        <h3>编辑元数据</h3>
        <label className="dlg-field">标题
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="dlg-field">作者
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="dlg-field">年份
          <input value={year} placeholder="可空"
                 onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="dlg-field">立场
          <select value={stance} onChange={(e) => setStance(e.target.value)}>
            {!stance && <option value="">（未分类）</option>}
            {stances.map((s) => (
              <option key={s.name} value={s.name}>{s.label || s.name}</option>))}
          </select>
        </label>
        <div className="dlg-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={saving} onClick={save}>
            {saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
