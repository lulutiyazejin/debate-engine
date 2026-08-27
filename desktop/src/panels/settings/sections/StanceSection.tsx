// 设置·立场管理分区（0.1.5 B1 拆分自 SettingsPanel）：
// 立场清单（预置不可删）+ 模板导入校验。全名（含括号注记）仅此处与 skill 文件可见（I6）。
import { useEffect, useState } from "react";
import { api } from "../../../api";
import { askConfirm } from "../../../components/AppDialog";

interface StanceRow { name: string; title?: string; builtin?: boolean; doc_count?: number }

interface Props {
  notify: (msg: string) => void;
  onChanged: () => void;
  tick: number;
}

export default function StanceSection({ notify, onChanged, tick }: Props) {
  const [stanceRows, setStanceRows] = useState<StanceRow[]>([]);
  const [stanceName, setStanceName] = useState("");
  const [stanceMd, setStanceMd] = useState("");

  useEffect(() => {
    api.get<{ stances: StanceRow[] }>("/api/stances")
      .then((r) => setStanceRows(r.stances)).catch(() => {});
  }, [tick]);

  const importStance = async () => {
    try {
      const r = await api.post<{ ok: boolean; title: string }>(
        "/api/stances/import", { name: stanceName.trim(), content: stanceMd });
      notify(`立场「${r.title}」已导入并热生效`);
      setStanceName(""); setStanceMd(""); onChanged();
    } catch (e) { notify(`导入未通过：${e}`); }
  };

  const delStance = async (name: string) => {
    // 0.1.8 M4：删前查挂靠文档数，下游影响写进确认文案
    const n = await api.get<{ doc_count: number }>(`/api/stances/${name}/usage`)
      .then((r) => r.doc_count).catch(() => 0);
    const body = n > 0
      ? `该立场下有 ${n} 篇文档，删除后它们将显示为未分类。确定删除？`
      : "其名下文档不会删除，只失去检索偏好。";
    if (!(await askConfirm({ title: `删除立场 ${name}？`, body, danger: true }))) return;
    try { await api.del(`/api/stances/${name}`); notify("已删除并热生效"); onChanged(); }
    catch (e) { notify(`删除失败: ${e}`); }
  };

  const copyTemplate = async () => {
    try {
      const r = await api.get<{ template: string }>("/api/stances/template");
      setStanceMd(r.template);
      navigator.clipboard?.writeText(r.template).catch(() => {});
      notify("模板已填入编辑框（并复制到剪贴板）");
    } catch (e) { notify(`获取模板失败: ${e}`); }
  };

  return (
    <>
      <h3>立场清单</h3>
      <p className="muted small">预置立场随包分发不可删；手动导入的立场可删除（文档不受影响）。</p>
      <div className="ledger">
        {stanceRows.map((s) => (
          <div key={s.name} className="ledger-row diag-row">
            <span>{(s.title || s.name).replace(/^SKILL[:：]\s*/, "")}
              <code style={{ marginLeft: 8 }}>{s.name}</code>
              <span className="muted small" style={{ marginLeft: 8 }}>{s.doc_count ?? 0} 篇</span></span>
            {s.builtin
              ? <span className="muted small">预置</span>
              : <button className="danger-btn" onClick={() => delStance(s.name)}>删除</button>}
          </div>
        ))}
      </div>
      <h3>导入新立场</h3>
      <p className="muted small">
        按模板六节撰写（世界观假设 / 反驳策略偏好 / 禁止使用的论证方式 /
        知识库检索偏好 / 默认回复风格 / Prompt 模板）；校验逐条报错，不静默拒载。
        <button className="link" onClick={copyTemplate}>取模板填入</button>
      </p>
      <div className="controls">
        <input value={stanceName} placeholder="立场 ID（仅英文 / 数字 / 下划线）"
               onChange={(e) => setStanceName(e.target.value)} />
      </div>
      <textarea className="stance-import" value={stanceMd} rows={10}
                placeholder={"# SKILL: 立场名称\n## 世界观假设\n…"}
                onChange={(e) => setStanceMd(e.target.value)} />
      <div className="controls">
        <button className="primary" disabled={!stanceName.trim() || !stanceMd.trim()}
                onClick={importStance}>校验并导入（热生效）</button>
      </div>
    </>
  );
}
