// 通用浮层菜单组件 (0.1.8 G1)
// Portal 挂 body → 避开 transform 祖先；视口 clamp 防溢出；点外关闭
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  key?: string;           // 分隔线键 "-"
  label: string;
  disabled?: boolean;     // 禁用态
  danger?: boolean;       // 危险操作（红色）
  onClick?: () => void;
}

interface Props {
  x: number; y: number;         // 锚点坐标（窗口内）
  items: MenuItem[];
  onClose: () => void;
}

export default function OverlayMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState<{ x: number; y: number }>({ x, y });

  useEffect(() => {
    // 视口 clamp（留 8px 边距）
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - 8) nx = Math.max(8, vw - rect.width - 8);
    if (ny + rect.height > vh - 8) ny = Math.max(8, vh - rect.height - 8);
    setClamped({ x: nx, y: ny });

    // 点外关闭（捕获阶段监听一次）
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [x, y, onClose]);

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: clamped.x, top: clamped.y }} role="menu">
      {items.map((item) => (
        item.key === "-" ? (
          <div key={item.key} className="separator" />
        ) : (
          <button key={item.key || item.label}
                  className={`menu-item${item.danger ? " danger" : ""}${item.disabled ? " disabled" : ""}`}
                  onClick={() => !item.disabled && item.onClick?.()}
                  role="menuitem"
                  disabled={item.disabled}>
            {item.label}
          </button>
        )
      ))}
    </div>,
    document.body
  );
}
