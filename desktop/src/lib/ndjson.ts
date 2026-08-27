// 0.1.4 批 5：NDJSON 进度流共用 util（ollama pull / 数据迁移 / 组件下载 / 重嵌入共用）。
// 事件约定：中途 {percent?, status?, speed_bps?}，结尾 {done:true, ok, detail}。
import { engineBase } from "../api";

export interface NdjsonEvent {
  done?: boolean; ok?: boolean; detail?: string;
  percent?: number; status?: string; speed_bps?: number;
  total?: number; done_bytes?: number;
  seq?: number; heartbeat?: boolean;   // 0.1.8 S3：BgTask 序号/心跳
  [k: string]: unknown;                // 业务扩展字段（对辩 round/side/text 等）
}

export async function ndjsonPost(
  path: string, body: unknown, onEvent: (evt: NdjsonEvent) => void,
  signal?: AbortSignal,   // 0.1.6 项 10：暂停/取消断流（后端客户端断开自停生成器）
): Promise<void> {
  const r = await fetch(`${engineBase()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}), signal,
  });
  if (!r.ok) {
    const detail = (await r.json().catch(() => null))?.detail || r.status;
    throw new Error(String(detail));
  }
  if (!r.body) throw new Error("无响应流");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export const fmtSpeed = (bps: number) =>
  bps > 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`;

// 0.1.8 S3：后台任务流消费——断流后 2s 自动重连，带 last_seq 续看进度
//（后端 BgTask 线程不受断流影响，任务仍在后台继续）。
export async function ndjsonPostResume(
  path: string, body: unknown, onEvent: (evt: NdjsonEvent) => void,
  signal?: AbortSignal, maxRetries = 30,
): Promise<void> {
  let lastSeq = 0;
  let retries = 0;
  for (;;) {
    try {
      const sep = path.includes("?") ? "&" : "?";
      await ndjsonPost(`${path}${sep}last_seq=${lastSeq}`, body, (evt) => {
        if (typeof evt.seq === "number") lastSeq = evt.seq;
        if (!evt.heartbeat) onEvent(evt);
        if (evt.done) retries = maxRetries;   // 正常结束不再重连
      }, signal);
      return;
    } catch (e) {
      if (signal?.aborted || retries >= maxRetries) throw e;
      retries += 1;
      onEvent({ status: "连接中断，任务仍在后台继续，已自动重连…" });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
