// 设置·界面分区（0.1.5 B1 拆分自 SettingsPanel）：
// 主题三态 / OKLCH 主色 / 窗口记忆 / 手势 / 快捷键。
import { useState } from "react";
import { loadKeys } from "../../../App";
import SegmentedSlider from "../../../components/SegmentedSlider";
import { setUiPref } from "../../../lib/uiPrefs";
import { getThemePref, setThemePref, type ThemePref,
         ACCENT_PRESETS, getAccentHue, setAccentHue } from "../../../theme";

interface Props {
  notify: (msg: string) => void;
}

export default function UiSection({ notify }: Props) {
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [accentHue, setAccentHueState] = useState<number>(getAccentHue());
  const [gestureOn, setGestureOn] = useState(() => localStorage.getItem("de.gesture") !== "off");
  const [gestureInv, setGestureInv] = useState(() => localStorage.getItem("de.gesture.invert") === "1");
  const [keySwitch, setKeySwitch] = useState(loadKeys().switch);
  const [winMem, setWinMem] = useState(() => localStorage.getItem("de.winmem") === "on");

  const saveSwitchKey = (v: string) => {
    // 系统保留组合拒绝（Alt+Tab / Win 键由 OS 截获，设了也无效）
    if (/^(Alt\+Tab|Win\+|Meta\+)/i.test(v)) { notify("该组合被系统占用，无法使用"); return; }
    setKeySwitch(v);
    setUiPref("de.keys", JSON.stringify({ ...loadKeys(), switch: v }));
    notify(`切面快捷键已改为 ${v}`);
  };

  return (
    <>
      <h3>主题</h3>
      <div className="controls">
        <SegmentedSlider value={theme}
          onChange={(v) => { setTheme(v as ThemePref); setThemePref(v as ThemePref); }}
          options={[{ key: "dark", label: "深色" }, { key: "light", label: "浅色" },
                    { key: "system", label: "跟随系统" }]} />
      </div>
      <p className="muted small">窗口标题栏随主题同步变色；导出的报告 HTML 固定纸感浅色（出版惯例）。</p>
      <h3>主色</h3>
      <div className="controls">
        {ACCENT_PRESETS.map((p) => (
          <button key={p.hue} className="swatch" title={p.name}
                  style={{ background: `oklch(0.55 0.15 ${p.hue}deg)`,
                           outline: accentHue === p.hue ? "2px solid var(--tx-1)" : "none" }}
                  onClick={() => { setAccentHueState(p.hue); setAccentHue(p.hue);
                                   notify(`主色已切换：${p.name}`); }} />
        ))}
        <input type="range" min={0} max={359} value={accentHue}
               title="自定义色相"
               onChange={(e) => { const h = Number(e.target.value);
                                  setAccentHueState(h); setAccentHue(h); }} />
      </div>
      <p className="muted small">只换强调色相；关闭钮红点、立场色、导出报告不受影响。</p>
      <h3>窗口</h3>
      <label className="chk">
        <input type="checkbox" checked={winMem}
               onChange={(e) => {
                 setWinMem(e.target.checked);
                 setUiPref("de.winmem", e.target.checked ? "on" : "off");
                 notify(e.target.checked
                   ? "已开启窗口记忆：下次启动恢复上次的位置与大小"
                   : "已关闭窗口记忆：下次启动回默认尺寸居中");
               }} /> 记住窗口位置与大小（默认关闭）
      </label>
      <h3>面切换</h3>
      <label className="chk">
        <input type="checkbox" checked={gestureOn}
               onChange={(e) => {
                 setGestureOn(e.target.checked);
                 setUiPref("de.gesture", e.target.checked ? "on" : "off");
               }} /> 启用长按右键滑动切面（滑动超过一定距离生效）
      </label>
      <label className="chk">
        <input type="checkbox" checked={gestureInv}
               onChange={(e) => {
                 setGestureInv(e.target.checked);
                 setUiPref("de.gesture.invert", e.target.checked ? "1" : "0");
               }} /> 反转滑动方向（默认：向左滑 = 去右边的面）
      </label>
      <h3>快捷键</h3>
      <div className="param-row">
        <span>切换两面</span>
        <select value={keySwitch} onChange={(e) => saveSwitchKey(e.target.value)}>
          {["Ctrl+Tab", "Ctrl+Q", "Ctrl+E", "Ctrl+Shift+Tab", "Alt+Q"].map((k) =>
            <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div className="param-row"><span>打开设置</span><code>{loadKeys().settings}</code></div>
    </>
  );
}
