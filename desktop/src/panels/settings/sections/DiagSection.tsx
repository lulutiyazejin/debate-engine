// 设置·诊断与日志分区（0.1.5 B1 拆分自 SettingsPanel）：
// 服务商可用性 + 任务落点台账（H1 后：实际落点归档于此）。
import type { TaskRow } from "./TasksSection";
import type { Provider } from "./ProvidersSection";

interface Props {
  providers: Provider[];
  tasks: TaskRow[];
}

export default function DiagSection({ providers, tasks }: Props) {
  return (
    <>
      <h3>服务商可用性</h3>
      <div className="ledger">
        {providers.map((p) => (
          <div key={p.name} className="ledger-row diag-row">
            <span>{p.name}</span>
            <span className={"badge " + (p.available ? "ok" : "warn")}>
              {p.available ? "在线" : "不可用"}</span>
          </div>
        ))}
      </div>
      <h3>任务落点</h3>
      <div className="ledger">
        {tasks.map((t) => (
          <div key={t.task} className="ledger-row diag-row">
            <span>{t.label}</span>
            <span className={"badge " + (t.active === "offline" ? "warn" : "ok")}>{t.active}</span>
          </div>
        ))}
      </div>
      <p className="muted small">详细 API 调用与降级记录见 knowledge_base/logs 目录（隐私分级脱敏）。</p>
    </>
  );
}
