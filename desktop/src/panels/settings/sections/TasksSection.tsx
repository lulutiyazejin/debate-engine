// 设置·任务分工分区（0.1.5 H1 终版）：编号槽组替代优先级链编辑器。
// 槽=下拉（选项=内置+自定义服务商；重复灰显、未配置灰显+原因不藏）；
// 编号=尝试序；保底 1 槽（删最后禁用）、行末＋加槽（上限 5）；
// 改动即 PATCH /api/config/task-slots 热生效；实际落点归诊断分区台账。
import { api } from "../../../api";
import type { CustomProv, Provider } from "./ProvidersSection";

export interface TaskRow { task: string; label: string; chain: string[]; active: string }

const MAX_SLOTS = 5;

interface Props {
  tasks: TaskRow[];
  providers: Provider[];
  customs: CustomProv[];
  notify: (msg: string) => void;
  onSaved: () => void;
}

export default function TasksSection({ tasks, providers, customs, notify, onSaved }: Props) {
  // 选项全集：内置 + 自定义（offline 是自动保底，不入槽）
  const options = [
    ...providers.map((p) => ({
      name: p.name, configured: p.configured,
      reason: p.configured ? "" : (p.name === "ollama" ? "未运行" : "未配置 Key"),
      hint: p.model ? `（${p.model}）` : "",
    })),
    ...customs.map((c) => ({
      name: c.name, configured: c.has_key,
      reason: c.has_key ? "" : "未配置 Key", hint: "（自定义）",
    })),
  ];

  const save = async (task: string, slots: string[]) => {
    try {
      await api.patch("/api/config/task-slots", { task, slots });
      notify("任务分工已保存并热生效");
      onSaved();
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  const setSlot = (t: TaskRow, i: number, name: string) => {
    if (!name) return;
    const next = [...t.chain];
    next[i] = name;
    void save(t.task, next);
  };
  const dropSlot = (t: TaskRow, i: number) => {
    if (t.chain.length <= 1) return;   // 保底 1 槽
    void save(t.task, t.chain.filter((_, j) => j !== i));
  };
  const addSlot = (t: TaskRow) => {
    const unused = options.find((o) => !t.chain.includes(o.name));
    if (!unused) { notify("没有可追加的服务商"); return; }
    void save(t.task, [...t.chain, unused.name]);
  };

  return (
    <>
      <h3>任务分工</h3>
      <p className="muted small">
        每类 AI 任务按编号槽依次尝试（① 失败换 ②）；交互场景槽失败会弹提示交你拍板，
        批量任务静默按槽序降级并在报告标注实际落点（见诊断分区台账）。
      </p>
      <div className="slot-table">
        {tasks.map((t) => (
          <div key={t.task} className="slot-row">
            <span className="slot-task"><code>{t.task}</code><em>{t.label}</em></span>
            <span className="slot-group">
              {t.chain.map((name, i) => (
                <span key={`${t.task}-${i}`} className="slot-cell">
                  <b>{i + 1}</b>
                  <select value={name}
                          onChange={(e) => setSlot(t, i, e.target.value)}>
                    {!options.some((o) => o.name === name) && (
                      <option value={name}>{name}（已移除）</option>)}
                    {options.map((o) => {
                      const dup = t.chain.includes(o.name) && o.name !== name;
                      return (
                        <option key={o.name} value={o.name}
                                disabled={dup || !o.configured}>
                          {o.name}{o.hint}
                          {dup ? "（已在其他槽）" : ""}
                          {!o.configured ? `（${o.reason}）` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <button className="slot-x" title={t.chain.length <= 1
                            ? "至少保留一个槽" : "删除此槽"}
                          disabled={t.chain.length <= 1}
                          onClick={() => dropSlot(t, i)}>×</button>
                </span>
              ))}
              {t.chain.length < MAX_SLOTS && (
                <button className="slot-add" title="加一个尝试槽"
                        onClick={() => addSlot(t)}>＋</button>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="muted small">全部槽都失败时自动降级离线模板（不需要配置）。</p>
    </>
  );
}
