// 通用分段滑移器（PLAN-0.1.5 J7）：滑块独立层绝对定位，CSS 变量驱动 translateX，
// transition 120ms ease-out 固定时长（与距离无关）；键盘 ←→ 切段；
// 文字 opacity 0.9（未选）→ 1.0（选）。应用面：馆藏五段 / 回应三段 / 对比子 tab /
// 立方体子投影 / 设置左导航（J8 同源节奏）。
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface SegOption { key: string; label: ReactNode; title?: string }

interface Props {
  options: SegOption[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

export default function SegmentedSlider({ options, value, onChange, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  // 位置测量：value / 布局变化时重写 CSS 变量（transform 驱动，零重排动画）
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const btn = host.querySelector<HTMLButtonElement>(
        `button[data-seg="${CSS.escape(value)}"]`);
      if (!btn) { host.style.setProperty("--seg-o", "0"); return; }
      host.style.setProperty("--seg-x", `${btn.offsetLeft}px`);
      host.style.setProperty("--seg-w", `${btn.offsetWidth}px`);
      host.style.setProperty("--seg-o", "1");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.key === value);
    const next = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
    if (next >= 0 && next < options.length) onChange(options[next].key);
  };

  return (
    <div ref={hostRef} role="tablist" tabIndex={0} onKeyDown={onKey}
         className={"seg-slide" + (className ? " " + className : "")}>
      <span className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.key} data-seg={o.key} role="tab" title={o.title}
                aria-selected={o.key === value}
                className={o.key === value ? "seg-on" : ""}
                onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}
