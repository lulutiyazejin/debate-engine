// 引擎 API 客户端：Tauri 握手取端口 → REST + SSE 流式
import { invoke } from "@tauri-apps/api/core";

let BASE = "";

export function engineBase(): string {
  return BASE;
}

/** 启动握手：轮询 Rust 侧 engine_port（引擎写盘的实际端口），
 *  拿到后再打 /api/health 确认就绪。冷启动（PyInstaller 解包）可达 30s。 */
export async function waitEngine(
  onStatus: (msg: string) => void,
  timeoutMs = 90_000,
): Promise<void> {
  const t0 = Date.now();
  onStatus("正在启动本地引擎…");
  while (Date.now() - t0 < timeoutMs) {
    const port = await invoke<number>("engine_port").catch(() => 0);
    if (port > 0) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) {
          BASE = `http://127.0.0.1:${port}`;
          return;
        }
      } catch {
        /* 引擎端口已写但服务还没接受连接，继续等 */
      }
      onStatus("引擎加载中（首次启动较慢）…");
    } else {
      const alive = await invoke<boolean>("engine_alive").catch(() => true);
      if (!alive && Date.now() - t0 > 8_000) {
        throw new Error("引擎进程已退出，请查看 knowledge_base/logs 下日志");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("引擎启动超时（90 秒）");
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = await r.json();
      detail = j.detail ?? JSON.stringify(j);
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(detail);
  }
  return r.json();
}

export const api = {
  get: <T>(path: string) => req<T>("GET", path),
  post: <T>(path: string, body?: unknown) => req<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => req<T>("PATCH", path, body),
  del: <T>(path: string) => req<T>("DELETE", path),
};

// ---------- 反驳 SSE 流（EventSource 不支持 POST，用 fetch 手工解析） ----------
export interface RebutRequest {
  argument: string;
  stance: string;
  format: string;
  style: string;
  length?: number | null;
  cite_format: string;
  fallacy: boolean;
  mode: string;
  center?: string | null;
  stream: true;
  intent?: string;               // rebut | critique | evaluate（0.1.2 项目16）
  material_ids?: number[];       // 素材篮注入（0.1.2 项目18）
}

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export async function rebutStream(
  reqBody: RebutRequest,
  onEvent: (evt: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`${BASE}/api/rebuttal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
    signal,
  });
  if (!r.ok || !r.body) {
    let detail = `${r.status}`;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE 帧以空行分隔
    for (;;) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent({ event, data: JSON.parse(data) });
    }
  }
}
