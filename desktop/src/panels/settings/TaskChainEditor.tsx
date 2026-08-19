// 0.1.4 批 5（决策 3）：任务分工总览 + 优先级链编辑器。
// 每行可展开：链内芯片支持 上移/下移/移除，未用服务商可追加；
// 保存 → PATCH /api/config/task-chains（热生效，落点列随 refresh 更新）。
import { useState } from "react";
import { api } from "../../api";

export interface TaskRow { task: string; label: string; chain: string[]; active: string }

interface Props {
  tasks: TaskRow[];
  /** 全部可入链的服务商名（内置+自定义），offline 不在此列 */
  providerNames: string[];
  notify: (msg: string) => void;
  onSaved: () => void;
}

export default function TaskChainEditor({ tasks, providerNames, notify, onSaved }: Props) {
  const [editTask, setEditTask] = useState<string | null>(null);
  const [chain, setChain] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const beginEdit = (t: TaskRow) => { setEditTask(t.task); setChain([...t.chain]); };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= chain.length) return;
    const next = [...chain];
    [next[i], next[j]] = [next[j], next[i]];
    setChain(next);
  };

  const save = async () => {
    if (!editTask || !chain.length) { notify("链不能为空，至少保留一个服务商"); return; }
    setSaving(true);
    try {
      await api.patch("/api/config/task-chains", { task: editTask, chain });
      notify("优先级链已保存并热生效");
      setEditTask(null); onSaved();
    } catch (e) { notify(`保存失败: ${e}`); } finally { setSaving(false); }
  };

  const unused = providerNames.filter((p) => !chain.includes(p));

  return (
    <table className="task-table">
      <thead><tr><th>任务</th><th>用途</th><th>优先级链</th><th>当前落点</th><th /></tr></thead>
      <tbody>
        {tasks.map((t) => (
          editTask === t.task ? (
            <tr key={t.task} className="chain-edit-row">
              <td><code>{t.task}</code></td>
              <td>{t.label}</td>
              <td colSpan={2}>
                <div className="chain-chips">
                  {chain.map((p, i) => (
                    <span key={p} className="chain-chip">
                      <b>{i + 1}.</b> {p}
                      <button title="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button title="下移" disabled={i === chain.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button title="从链中摘除" disabled={chain.length <= 1}
                              onClick={() => setChain(chain.filter((x) => x !== p))}>×</button>
                    </span>
                  ))}
                  {unused.length > 0 && (
                    <select value="" onChange={(e) => e.target.value && setChain([...chain, e.target.value])}>
                      <option value="">追加…</option>
                      {unused.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </div>
              </td>
              <td className="chain-edit-ops">
                <button className="primary" disabled={saving} onClick={save}>保存</button>
                <button onClick={() => setEditTask(null)}>取消</button>
              </td>
            </tr>
          ) : (
            <tr key={t.task}>
              <td><code>{t.task}</code></td>
              <td>{t.label}</td>
              <td className="muted">{t.chain.join(" → ")}</td>
              <td><span className={"badge " + (t.active === "offline" ? "warn" : "ok")}>{t.active}</span></td>
              <td><button className="link" onClick={() => beginEdit(t)}>编辑链</button></td>
            </tr>
          )
        ))}
      </tbody>
    </table>
  );
}
