// 三态主题系统（项目24）：深色 / 浅色 / 跟随系统。
// 关键点：Tauri Window.setTheme 驱动 DWM 标题栏随主题（Win10 1809+），
// data-theme 驱动 tokens.css 双色板；跟随系统时监听 onThemeChanged。
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setUiPref } from "./lib/uiPrefs";

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
  setUiPref(KEY, pref);   // 0.1.6 项 7：双写 localStorage+后端镜像
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
  applyAccent(getAccentHue());
  await setThemePref(getThemePref());
}

// ---------- 0.1.4 批 0-2：主色系（OKLCH 只换色相，C/L 锁在 tokens.css） ----------
const ACCENT_KEY = "de.accent";
export const ACCENT_PRESETS: { name: string; hue: number }[] = [
  { name: "朱红", hue: 25 }, { name: "黛蓝", hue: 250 },
  { name: "松绿", hue: 150 }, { name: "赭黄", hue: 75 },
  { name: "绛紫", hue: 330 },
];

export function getAccentHue(): number {
  const v = Number(localStorage.getItem(ACCENT_KEY));
  return Number.isFinite(v) && localStorage.getItem(ACCENT_KEY) !== null ? v : 25;
}

function applyAccent(hue: number) {
  // 只改色相来源；两主题各自锁 C/L（tokens.css），语义色不受影响
  document.documentElement.style.setProperty(
    "--main-color", `oklch(0.65 0.18 ${hue}deg)`);
}

export function setAccentHue(hue: number): void {
  setUiPref(ACCENT_KEY, String(hue));   // 0.1.6 项 7：镜像后端
  applyAccent(hue);
}

/** D12 字体外挂：knowledge_base/fonts 下的字体文件注册为正文首选。
 *  引擎就绪后调用（需要 engineBase 已握手）。无字体 = 静默走系统字体栈。 */
export async function initExternalFonts(base: string): Promise<void> {
  try {
    const r = await fetch(`${base}/api/fonts`);
    const { fonts } = (await r.json()) as { fonts: string[] };
    if (!fonts?.length) return;
    const families: string[] = [];
    for (const f of fonts) {
      const fam = f.replace(/\.[^.]+$/, "");
      const face = new FontFace(fam, `url("${base}/fonts/${encodeURIComponent(f)}")`);
      await face.load();
      document.fonts.add(face);
      families.push(`"${fam}"`);
    }
    const cur = getComputedStyle(document.documentElement)
      .getPropertyValue("--sans");
    document.documentElement.style.setProperty(
      "--sans", `${families.join(", ")}, ${cur}`);
  } catch { /* 字体加载失败不影响主流程 */ }
}
