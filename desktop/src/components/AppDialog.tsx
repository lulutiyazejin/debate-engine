// 0.1.6 项 5：自定义弹窗（替换全部原生 prompt/confirm，拍板 2A）。
// 命令式 API：askInput / askConfirm 返回 Promise，DialogHost 挂在 App 根。
// 纸感 token；Enter=确认、Esc/遮罩点=取消；输入框 autofocus；danger 红描边。
import { useEffect, useState } from "react";

interface InputOpts { title: string; initial?: string; placeholder?: string; okText?: string }
interface ConfirmOpts { title: string; body?: string; danger?: boolean; okText?: string }
type Req =
  | ({ kind: "input"; resolve: (v: string | null) => void } & InputOpts)
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOpts);

let push: ((r: Req) => void) | null = null;

export function askInput(opts: InputOpts): Promise<string | null> {
  return new Promise((resolve) =>
    push ? push({ kind: "input", ...opts, resolve }) : resolve(null));
}
export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) =>
    push ? push({ kind: "confirm", ...opts, resolve }) : resolve(false));
}

export default function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    push = (r) => { setReq(r); setText(r.kind === "input" ? r.initial ?? "" : ""); };
    return () => { push = null; };
  }, []);

  // Esc 全局兜底（confirm 无输入框时焦点可能在按钮外）
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (req.kind === "input") req.resolve(null); else req.resolve(false);
      setReq(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  if (!req) return null;
  const cancel = () => {
    if (req.kind === "input") req.resolve(null); else req.resolve(false);
    setReq(null);
  };
  const ok = () => {
    if (req.kind === "input") req.resolve(text); else req.resolve(true);
    setReq(null);
  };

  return (
    <div className="overlay dlg-overlay" onClick={cancel}>
      <div className="dlg-card" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-title">{req.title}</div>
        {req.kind === "input" ? (
          <input autoFocus value={text} placeholder={req.placeholder}
                 onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") ok(); }} />
        ) : (
          req.body && <div className="dlg-body">{req.body}</div>
        )}
        <div className="dlg-actions">
          <button onClick={cancel}>取消</button>
          <button className={req.kind === "confirm" && req.danger ? "danger-btn" : "primary"}
                  autoFocus={req.kind === "confirm"} onClick={ok}>
            {req.okText || "确定"}</button>
        </div>
      </div>
    </div>
  );
}
