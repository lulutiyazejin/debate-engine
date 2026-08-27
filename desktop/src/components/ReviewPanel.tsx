// 待审队列面板（0.1.8 M2）：批量导入的文档逐篇卡片审核——
// 可改立场/元数据后「通过」，或「全部通过」一键清空队列。
// pending 文档不参与检索/图谱/脉络/回应素材（后端统一过滤）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { stanceLabel as _stanceLabel } from "../lib/stance";
import type { DocRow, StanceOpt } from "../App";

interface Props {
  docs: DocRow[];             // 全量文档（内部筛 pending）
  stances: StanceOpt[];
  notify: (msg: string) => void;
  onClose: () => void;
  onChanged: () => void;      // 通过后刷新文档列表
}

export default function ReviewPanel({ docs, stances, notify, onClose, onChanged }: Props) {
  const pending = docs.filter((d) => d.review_status === "pending");
  const [busy, setBusy] = useState(false);
  const [stanceEdit, setStanceEdit] = useState<Record<string, string>>({});

  const approve = async (d: DocRow) => {
    setBusy(true);
    try {
      const ns = stanceEdit[d.doc_id];
      if (ns && ns !== d.stance) {
        await api.patch(`/api/knowledge/docs/${d.doc_id}/stance`, { stance: ns });
      }
      await api.post(`/api/knowledge/docs/${d.doc_id}/approve`, {});
      notify(`「${d.title || d.doc_id}」已通过审核`);
      onChanged();
    } catch (e) { notify(`审核失败: ${e}`); }
    finally { setBusy(false); }
  };

  const approveAll = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ approved: number }>("/api/knowledge/approve-all", {});
      notify(`已全部通过（${r.approved} 篇）`);
      onChanged();
      onClose();
    } catch (e) { notify(`操作失败: ${e}`); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="reader-backdrop" onClick={onClose}>
      <div className="reader-shell" style={{ width: "min(680px, 90vw)" }}
           onClick={(e) => e.stopPropagation()}>
        <header className="reader-head">
          <b className="reader-title">待审文档（{pending.length}）</b>
          <span className="reader-spacer" />
          {pending.length > 0 && (
            <button className="primary" disabled={busy} onClick={approveAll}>
              全部通过</button>
          )}
          <button className="link" onClick={onClose}>关闭 ×</button>
        </header>
        <div className="reader-body">
          {pending.length === 0 && (
            <div className="empty-state"><p>没有待审文档</p></div>
          )}
          {pending.map((d) => (
            <div key={d.doc_id} className="confirm-card" style={{ marginBottom: 12 }}>
              <h3>{d.title || d.doc_id}</h3>
              <div className="muted small">
                {String(d.author || "佚名")} · {d.year ?? "年代不详"} ·
                AI 推断立场：{_stanceLabel(d.stance || "", stances)}
              </div>
              {d.summary && <p className="muted small">{String(d.summary).slice(0, 200)}</p>}
              <div className="controls">
                <label>立场
                  <select value={stanceEdit[d.doc_id] ?? d.stance ?? ""}
                          onChange={(e) => setStanceEdit((prev) =>
                            ({ ...prev, [d.doc_id]: e.target.value }))}>
                    {stances.map((s) => (
                      <option key={s.name} value={s.name}>{s.label || s.name}</option>))}
                  </select>
                </label>
                <button className="primary" disabled={busy} onClick={() => approve(d)}>
                  通过</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
