// 全局错误边界（0.1.8 热修）：React 渲染崩溃时不再黑屏，
// 显示错误详情 + 复制按钮 + 「清除本地状态」自救（localStorage 引发的启动崩溃可自愈）。
// 同时兜底 window.onerror / unhandledrejection（挂载后的脚本错误也可见）。
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface State { error: Error | null; stack: string }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: `${error.stack || ""}\n组件栈:${info.componentStack || ""}` });
  }

  componentDidMount() {
    // 渲染外的未捕获错误也显示（异步回调/事件里抛出的）
    window.addEventListener("error", this.onWinError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWinError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  private onWinError = (e: ErrorEvent) => {
    if (!this.state.error)
      this.setState({ error: e.error instanceof Error ? e.error : new Error(String(e.message)),
                      stack: e.error?.stack || `${e.filename}:${e.lineno}` });
  };

  private onRejection = (e: PromiseRejectionEvent) => {
    // Promise 拒绝多为业务请求失败，已有 notify 通道，只记录不接管界面
    console.error("[unhandledrejection]", e.reason);
  };

  private copy = () => {
    const text = `${this.state.error?.message || ""}\n${this.state.stack}`;
    try { navigator.clipboard.writeText(text); } catch { /* WebView 剪贴板受限时忽略 */ }
  };

  private reset = () => {
    try { localStorage.clear(); } catch { /* 忽略 */ }
    location.reload();
  };

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 24, height: "100vh", overflow: "auto", boxSizing: "border-box",
                    background: "#141414", color: "#ddd", fontSize: 13, lineHeight: 1.6 }}>
        <h2 style={{ color: "#e66", margin: "0 0 8px" }}>界面渲染出错（截图或复制以下信息反馈）</h2>
        <p style={{ margin: "0 0 12px", wordBreak: "break-all" }}><b>{error.message}</b></p>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <button onClick={this.copy}>复制错误信息</button>
          <button onClick={() => location.reload()}>重新加载</button>
          <button onClick={this.reset} title="清除窗口记忆/视图偏好等本地状态后重载，数据库不受影响">
            清除本地状态并重载</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#999",
                      background: "#1c1c1c", padding: 12, borderRadius: 4 }}>{stack}</pre>
      </div>
    );
  }
}
