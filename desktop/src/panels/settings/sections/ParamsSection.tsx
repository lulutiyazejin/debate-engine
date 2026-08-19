// 设置·生成与检索参数分区（0.1.5 B1 拆分自 SettingsPanel）。
// I7：blur 数值校验——越界回退旧值不落盘。
import { useEffect, useState } from "react";
import { api } from "../../../api";

const FIELDS = [
  { key: "retrieval_top_k", label: "最终引用条数 Top-K", min: 1, max: 20 },
  { key: "retrieval_top_k_coarse", label: "粗检索每路 Top-K", min: 5, max: 100 },
  { key: "full_context_token_limit", label: "整书投喂 token 上限", min: 1000, max: 500000 },
] as const;

interface Props {
  notify: (msg: string) => void;
  tick: number;
}

export default function ParamsSection({ notify, tick }: Props) {
  const [params, setParams] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});

  useEffect(() => {
    api.get<Record<string, number>>("/api/config/params")
      .then((r) => { setParams(r); setSaved(r); }).catch(() => {});
  }, [tick]);

  const patchParam = async (key: string, v: number) => {
    try {
      const r = await api.patch<Record<string, number>>("/api/config/params", { [key]: v });
      setParams(r); setSaved(r);
      notify("参数已热生效");
    } catch (e) { notify(`保存失败: ${e}`); }
  };

  // I7：blur 校验——非数 / 越界回退旧值
  const onBlur = (f: typeof FIELDS[number], raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < f.min || v > f.max) {
      setParams({ ...params, [f.key]: saved[f.key] });
      notify(`「${f.label}」允许 ${f.min}–${f.max}，已回退原值`);
      return;
    }
    if (v !== saved[f.key]) patchParam(f.key, v);
  };

  return (
    <>
      <h3>生成与检索参数</h3>
      <p className="muted small">写入 settings.json 并立即热生效（跟知识库走，分享包不含）。</p>
      {FIELDS.map((f) => (
        <div key={f.key} className="param-row">
          <span>{f.label}</span>
          <input type="number" min={f.min} max={f.max}
                 value={params[f.key] ?? ""}
                 onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })}
                 onBlur={(e) => onBlur(f, e.target.value)} />
        </div>
      ))}
    </>
  );
}
