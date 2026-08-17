"""结构化日志：JSONL 格式，trace_id 贯穿，隐私分级，写入失败静默降级。

六类日志文件：api_calls / ingestion / retrieval / behavior / errors / system
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_trace_id() -> str:
    return uuid.uuid4().hex[:12]


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _write(log_name: str, entry: dict) -> None:
    """写入单行 JSONL。任何异常静默吞掉——日志失败绝不影响主功能。"""
    try:
        config.LOGS_PATH.mkdir(parents=True, exist_ok=True)
        path = config.LOGS_PATH / f"{log_name}.jsonl"
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception:
        pass


def _base(trace_id: str, event: str, component: str, level: str = "INFO") -> dict:
    return {
        "ts": now_iso(),
        "trace_id": trace_id,
        "level": level,
        "component": component,
        "event": event,
    }


def log_api_call(trace_id: str, task: str, provider: str, model: str,
                 status: str, latency_ms: int, input_tokens: int = 0,
                 output_tokens: int = 0, fallback_from: str | None = None,
                 error: str | None = None, **ctx) -> None:
    e = _base(trace_id, "api_call", "llm_client")
    e.update(task=task, provider=provider, model=model, status=status,
             latency_ms=latency_ms, input_tokens=input_tokens,
             output_tokens=output_tokens, fallback_from=fallback_from)
    if error:
        e["error"] = error[:300]
    if config.LOG_PRIVACY_LEVEL != "minimal":
        e.update(ctx)
    _write("api_calls", e)


def log_ingestion(trace_id: str, event: str, doc_id: str, **fields) -> None:
    e = _base(trace_id, event, "ingestion")
    e["doc_id"] = doc_id
    if config.LOG_PRIVACY_LEVEL != "minimal":
        e.update(fields)
    else:
        for k in ("stage", "status", "duration_ms", "chapter_id"):
            if k in fields:
                e[k] = fields[k]
    _write("ingestion", e)


def log_retrieval(trace_id: str, query: str, stance: str, style: str,
                  fts_hits: int, vector_hits: int, final_chunks: int,
                  top_score: float, retrieval_ms: int, **quality) -> None:
    e = _base(trace_id, "retrieval_complete", "retriever")
    e.update(stance=stance, style=style, fts5_hits=fts_hits,
             vector_hits=vector_hits, final_chunks=final_chunks,
             top_score=round(top_score, 4), retrieval_ms=retrieval_ms)
    if config.LOG_PRIVACY_LEVEL == "debug":
        e["query"] = query
    elif config.LOG_PRIVACY_LEVEL == "standard":
        e["query_hash"] = sha256_text(query)
        e["query_len"] = len(query)
    if quality:
        e["quality"] = quality
    _write("retrieval", e)


def log_behavior(trace_id: str, action: str, **fields) -> None:
    e = _base(trace_id, "user_action", "frontend")
    e["action"] = action
    e.update(fields)
    _write("behavior", e)


def log_error(trace_id: str, component: str, message: str,
              context: dict | None = None, auto_fix: str | None = None) -> None:
    e = _base(trace_id, "error", component, level="ERROR")
    e["message"] = message[:500]
    if context:
        e["context"] = context
    if auto_fix:
        e["auto_fix"] = auto_fix
    _write("errors", e)


def log_system(event: str, **fields) -> None:
    e = _base(new_trace_id(), event, "system")
    e.update(fields)
    _write("system", e)


class Timer:
    """with Timer() as t: ... ; t.ms"""
    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = int((time.perf_counter() - self._t0) * 1000)
        return False
