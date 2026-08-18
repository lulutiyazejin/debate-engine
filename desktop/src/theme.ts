// 三态主题系统（项目24）：深色 / 浅色 / 跟随系统。
// 关键点：Tauri Window.setTheme 驱动 DWM 标题栏随主题（Win10 1809+），
// data-theme 驱动 tokens.css 双色板；跟随系统时监听 onThemeChanged。
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "dark" | "light" | "system";

const KEY = "de.theme";
let unlisten: (() => void) | null = null;

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

function apply(mode: "dark" | "light") {
  document.documentElement.dataset.theme = mode;
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  localStorage.setItem(KEY, pref);
  const win = getCurrentWindow();
  unlisten?.();
  unlisten = null;
  if (pref === "system") {
    // null = 跟随系统；标题栏与 WebView 均交还 OS
    await win.setTheme(null).catch(() => {});
    const sys = await win.theme().catch(() => null);
    apply(sys === "light" ? "light" : "dark");
    unlisten = await win.onThemeChanged(({ payload }) => {
      apply(payload === "light" ? "light" : "dark");
    }).catch(() => null);
  } else {
    await win.setTheme(pref).catch(() => {});
    apply(pref);
  }
}

/** 启动时调用一次（App 挂载即执行，避免首帧色板错位） */
export async function initTheme(): Promise<void> {
  await setThemePref(getThemePref());
}
