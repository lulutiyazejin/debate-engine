// 设置·诊断与日志分区（0.1.5 B1 拆分自 SettingsPanel）：
// 服务商可用性 + 任务落点台账（H1 后：实际落点归档于此）。
import type { TaskRow } from "./TasksSection";
import type { Provider } from "./ProvidersSection";

interface Props {
  providers: Provider[];
  tasks: TaskRow[];
  embedder: { impl: string; model: string; is_fallback: boolean } | null;
  components: { name: string; state: string }[];
}

export default function DiagSection({ providers, tasks, embedder, components }: Props) {
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
      {/* 0.1.8 S2：降级状态一览 */}
      <h3>降级状态一览</h3>
      <div className="ledger">
        {/* 嵌入器：当前实现名 + 真值/降级提示 */}
        {embedder && (
          <div className="ledger-row diag-row">
            <span>语义检索 ({embedder.impl})</span>
            {embedder.is_fallback ? (
              <span className="badge warn">词袋近似中（去组件中心装 BGE-M3）</span>
            ) : (
              <span className="badge ok">正常 ({embedder.model})</span>
            )}
          </div>
        )}
        {/* OCR / Docling / MinerU 三组件状态 */}
        {(components || []).map(c => (
          c.state !== "installed" && (
            <div key={c.name} className="ledger-row diag-row">
              <span>{c.name === "ocr" ? "OCR 识别" : c.name === "docling" ? "Docling 解析" : "MinerU"}</span>
              <span className="badge warn">降级中（去组件中心装）</span>
            </div>
          )
        ))}
      </div>
      <p className="muted small">详细 API 调用与降级记录见 knowledge_base/logs 目录（隐私分级脱敏）。</p>
    </>
  );
}
