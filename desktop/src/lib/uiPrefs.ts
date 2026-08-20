// 0.1.6 项 7：UI 偏好迁 settings.json（跟知识库走，升级/换 WebView2 档案不丢）。
// 策略：读路径保持 localStorage（首帧防闪、现有读逻辑零改动）；写路径双写
// （localStorage + PATCH 后端镜像，防抖 300ms）；启动 syncUiPrefs()：
// 后端有值 → 灌回 localStorage（继承）；后端缺键且本地有值 → 一次性迁移 PATCH（幂等）。
// 值一律存 localStorage 原串，无损往返。
import { api } from "../api";

interface MapEntry { key: string; ls: string }
const MAP: MapEntry[] = [
  { key: "theme", ls: "de.theme" },
  { key: "accent_hue", ls: "de.accent" },
  { key: "gesture_on", ls: "de.gesture" },
  { key: "gesture_invert", ls: "de.gesture.invert" },
  { key: "key_switch", ls: "de.keys" },
  { key: "winmem", ls: "de.winmem" },
  { key: "cube_invert", ls: "de.cube.invert" },
  { key: "cube_labels", ls: "de.cube.labels" },
  { key: "cube_alpha", ls: "de.cube.alpha" },
  { key: "cube_cols", ls: "de.cube.cols" },
  { key: "graph_labels", ls: "de.graph.labels" },
];

const timers = new Map<string, number>();

/** 写偏好：localStorage 立即生效 + 防抖镜像到后端 settings.json。 */
export function setUiPref(ls: string, value: string): void {
  localStorage.setItem(ls, value);
  const ent = MAP.find((m) => m.ls === ls);
  if (!ent) return;
  const old = timers.get(ent.key);
  if (old) window.clearTimeout(old);
  timers.set(ent.key, window.setTimeout(() => {
    timers.delete(ent.key);
    api.patch("/api/config/ui-prefs", { [ent.key]: value }).catch(() => {});
  }, 300));
}

/** 启动同步（引擎就绪后调一次）：后端为准继承；本地旧值一次性迁移。 */
export async function syncUiPrefs(): Promise<void> {
  try {
    const remote = await api.get<Record<string, unknown>>("/api/config/ui-prefs");
    const missing: Record<string, string> = {};
    for (const m of MAP) {
      const rv = remote[m.key];
      const lv = localStorage.getItem(m.ls);
      if (typeof rv === "string") {
        if (rv !== lv) localStorage.setItem(m.ls, rv);
      } else if (lv !== null) {
        missing[m.key] = lv;   // 后端缺键且本地有值 → 迁移
      }
    }
    if (Object.keys(missing).length) {
      await api.patch("/api/config/ui-prefs", missing).catch(() => {});
    }
  } catch { /* 引擎未起不阻断启动 */ }
}
