"""模型路由器：任务 → 优先级链 → 自动降级。

降级规则：
- rate_limit / timeout / other → 切换链中下一个
- content_filter → 直接跳到本地 Ollama（跳过其余云端）
- 全部失败 → OfflineProvider 兜底（模板输出，明确标注）
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import log_error, new_trace_id
from models.llm_client import LLMError, Provider, build_providers


class SlotFailure(Exception):
    """0.1.5 H1：交互场景槽失败事件——携带失败槽/原因/下一槽，
    前端动作 toast 交用户拍板（切换/重试/离线模板），不自动降级。"""

    def __init__(self, failed: str, reason: str, next_name: str | None):
        self.failed, self.reason, self.next = failed, reason, next_name
        super().__init__(f"{failed} failed ({reason})")


_REASON_LABEL = {"rate_limit": "限流", "timeout": "超时", "auth": "鉴权失败",
                 "content_filter": "内容过滤", "other": "请求失败"}


class ModelRouter:
    def __init__(self, providers: dict[str, Provider] | None = None):
        self.providers = providers or build_providers()

    def _chain(self, task: str) -> list[str]:
        chains = config.effective_task_chains()
        return chains.get(task, chains["rebuttal"])

    def run(self, task: str, messages: list[dict],
            trace_id: str | None = None, **kw) -> tuple[str, str]:
        """执行任务，返回 (输出文本, 实际使用的服务商名)。"""
        trace_id = trace_id or new_trace_id()
        chain = [n for n in self._chain(task) if n in self.providers]
        last_err: Exception | None = None
        tried: list[str] = []

        i = 0
        while i < len(chain):
            name = chain[i]
            p = self.providers[name]
            i += 1
            if not p.available():
                continue
            tried.append(name)
            try:
                out = p.chat(messages, task=task, trace_id=trace_id, **kw)
                return out, name
            except LLMError as e:
                last_err = e
                if e.kind == "content_filter":
                    # 内容过滤：直接尝试本地，跳过其余云端
                    ollama = self.providers.get("ollama")
                    if ollama and ollama.available() and "ollama" not in tried:
                        try:
                            out = ollama.chat(messages, task=task,
                                              trace_id=trace_id, **kw)
                            return out, "ollama"
                        except LLMError as e2:
                            last_err = e2
                    break
                # rate_limit / timeout / auth / other → 链中下一个
                continue

        # 全部失败 → 离线兜底
        log_error(trace_id, "model_router",
                  f"all providers failed for task={task}, tried={tried}, "
                  f"last={last_err}", auto_fix="offline_fallback")
        offline = self.providers["offline"]
        return offline.chat(messages, task=task, trace_id=trace_id), "offline"

    def run_interactive(self, task: str, messages: list[dict],
                        provider: str | None = None,
                        trace_id: str | None = None, **kw) -> tuple[str, str]:
        """0.1.5 H1 交互场景：槽 1（首个可用槽）失败不自动降级，
        抛 SlotFailure(failed, reason, next) 交前端动作 toast；
        provider 指定时（用户拍板后重进）只试该槽；offline 直接模板。"""
        trace_id = trace_id or new_trace_id()
        if provider == "offline":
            offline = self.providers["offline"]
            return offline.chat(messages, task=task, trace_id=trace_id), "offline"
        chain = [n for n in self._chain(task) if n in self.providers]
        avail = [n for n in chain if self.providers[n].available()]
        if provider is None:
            if not avail:   # 全部未配置/不可用 → 离线回退（与静默路径一致）
                offline = self.providers["offline"]
                return (offline.chat(messages, task=task, trace_id=trace_id),
                        "offline")
            provider = avail[0]
        after = avail[avail.index(provider) + 1:] if provider in avail else avail
        nxt = after[0] if after else None
        p = self.providers.get(provider)
        if p is None or not p.available():
            raise SlotFailure(provider, "不可用", nxt)
        try:
            out = p.chat(messages, task=task, trace_id=trace_id, **kw)
            return out, provider
        except LLMError as e:
            log_error(trace_id, "model_router",
                      f"interactive slot failed task={task} "
                      f"provider={provider} kind={e.kind}",
                      auto_fix="await_user_action")
            raise SlotFailure(provider,
                              _REASON_LABEL.get(e.kind, e.kind), nxt) from e

    def health(self) -> dict[str, bool]:
        return {n: p.available() for n, p in self.providers.items()
                if n != "offline"}


_router: ModelRouter | None = None


def get_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router


def reset_router() -> None:
    """Key 热重载后重建路由器（config 命令/设置页保存时调用）。"""
    global _router
    _router = None
