"""后台任务 helper（0.1.8 S3）：daemon 线程跑任务体，进度写环形缓冲，
HTTP 端点只转发——WebView 断流不再杀任务（0.1.6 热修 5 模式的正式化）。

用法：
    task = BgTask.get_or_start("mineru-install", worker_fn)
    return StreamingResponse(task.follow(last_seq), ...)

worker_fn 签名：fn(emit)，emit(dict) 把进度事件推进缓冲；
结尾事件须带 {"done": True, "ok": bool, "detail": str}。
同名任务进行中时新请求接入续看（从 last_seq 续读）而非重启；
done 后注册表保留 5 分钟供迟到客户端读结果，随后可重启同名任务。
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from typing import Callable

_REGISTRY: dict[str, "BgTask"] = {}
_LOCK = threading.Lock()

# 环形缓冲长度：进度事件足够回放（pip 输出行 ~千级，尾部最新最重要）
_BUF_MAX = 2000
# done 后保留时长（秒）：迟到客户端仍能读到结果
_KEEP_DONE = 300


class BgTask:
    def __init__(self, name: str):
        self.name = name
        self.buf: deque[tuple[int, dict]] = deque(maxlen=_BUF_MAX)
        self.seq = 0
        self.done = False
        self.done_at = 0.0
        self.event = threading.Event()
        self.cancel_flag = threading.Event()
        self._lock = threading.Lock()

    # ---------- 生产侧（worker 线程内调用） ----------
    def emit(self, obj: dict) -> None:
        with self._lock:
            self.seq += 1
            self.buf.append((self.seq, obj))
            if obj.get("done"):
                self.done = True
                self.done_at = time.time()
        self.event.set()

    @property
    def cancelled(self) -> bool:
        """worker 体内轮询：取消按钮才真杀任务（断流不算）。"""
        return self.cancel_flag.is_set()

    # ---------- 消费侧（HTTP 端点生成器） ----------
    def follow(self, last_seq: int = 0):
        """NDJSON 生成器：从 last_seq 之后续读；断流后客户端带 seq 重连续看。"""
        cursor = last_seq
        while True:
            batch: list[str] = []
            with self._lock:
                for s, obj in self.buf:
                    if s > cursor:
                        batch.append(json.dumps({**obj, "seq": s},
                                                ensure_ascii=False) + "\n")
                        cursor = s
                finished = self.done
            for line in batch:
                yield line
            if finished:
                return
            self.event.clear()
            # 30s 心跳：无进度也发一行防中间层空闲超时断连
            if not self.event.wait(timeout=30):
                yield json.dumps({"heartbeat": True, "seq": cursor},
                                 ensure_ascii=False) + "\n"

    # ---------- 注册表 ----------
    @staticmethod
    def get(name: str) -> "BgTask | None":
        with _LOCK:
            t = _REGISTRY.get(name)
            if t and t.done and time.time() - t.done_at > _KEEP_DONE:
                del _REGISTRY[name]
                return None
            return t

    @staticmethod
    def get_or_start(name: str, worker: Callable[["BgTask"], None]) -> "BgTask":
        """进行中→接入续看；已结束（过保留期）/不存在→新起 daemon 线程。"""
        with _LOCK:
            t = _REGISTRY.get(name)
            if t and not t.done:
                return t
            if t and time.time() - t.done_at <= _KEEP_DONE:
                return t     # 保留期内返回旧结果，避免误触发重跑
            t = BgTask(name)
            _REGISTRY[name] = t

        def _run():
            try:
                worker(t)
            except Exception as e:  # noqa: BLE001 任务体异常显式化为结果事件
                t.emit({"done": True, "ok": False, "detail": f"任务异常：{e}"})
            if not t.done:   # worker 忘发结尾事件的保险
                t.emit({"done": True, "ok": True, "detail": "完成"})

        threading.Thread(target=_run, daemon=True, name=f"bgtask-{name}").start()
        return t

    @staticmethod
    def cancel(name: str) -> bool:
        with _LOCK:
            t = _REGISTRY.get(name)
        if t and not t.done:
            t.cancel_flag.set()
            return True
        return False
