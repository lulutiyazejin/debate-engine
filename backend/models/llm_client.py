"""LLM API 统一适配层：OpenAI 格式，多提供商，含离线降级。

OfflineProvider：无任何 API Key 可用时的兜底——基于检索结果的模板化输出，
明确标注"离线模式"，保证 CLI 全链路在无网/无Key环境可验证。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import Timer, log_api_call, new_trace_id


class LLMError(Exception):
    def __init__(self, kind: str, message: str):
        self.kind = kind  # rate_limit / content_filter / timeout / auth / other
        super().__init__(message)


class Provider:
    def __init__(self, name: str, base_url: str, api_key: str, model: str):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._avail_cache: bool | None = None
        self._avail_expire = 0.0

    def available(self) -> bool:
        if self.name == "ollama":
            # 探活结果缓存 60s，避免每次任务都等超时
            now = time.monotonic()
            if self._avail_cache is not None and now < self._avail_expire:
                return self._avail_cache
            try:
                r = httpx.get(self.base_url.replace("/v1", "") + "/api/tags",
                              timeout=0.5)
                ok = r.status_code == 200
            except Exception:
                ok = False
            self._avail_cache, self._avail_expire = ok, now + 60
            return ok
        return bool(self.api_key)

    def chat(self, messages: list[dict], task: str = "generic",
             trace_id: str | None = None, max_tokens: int = 2048,
             temperature: float = 0.7, timeout: float = 60.0) -> str:
        trace_id = trace_id or new_trace_id()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {"model": self.model, "messages": messages,
                   "max_tokens": max_tokens, "temperature": temperature}
        with Timer() as t:
            try:
                r = httpx.post(f"{self.base_url}/chat/completions",
                               headers=headers, json=payload, timeout=timeout)
            except httpx.TimeoutException as e:
                log_api_call(trace_id, task, self.name, self.model,
                             "timeout", t.ms, error=str(e))
                raise LLMError("timeout", f"{self.name} timeout") from e
            except httpx.HTTPError as e:
                log_api_call(trace_id, task, self.name, self.model,
                             "network_error", t.ms, error=str(e))
                raise LLMError("other", f"{self.name} network: {e}") from e

        if r.status_code == 429:
            log_api_call(trace_id, task, self.name, self.model,
                         "rate_limited", t.ms)
            raise LLMError("rate_limit", f"{self.name} 429")
        if r.status_code in (400, 451, 422):
            body = r.text[:200]
            log_api_call(trace_id, task, self.name, self.model,
                         "content_filtered", t.ms, error=body)
            raise LLMError("content_filter", f"{self.name} {r.status_code}: {body}")
        if r.status_code in (401, 403):
            log_api_call(trace_id, task, self.name, self.model,
                         "auth_error", t.ms)
            raise LLMError("auth", f"{self.name} auth failed")
        if r.status_code != 200:
            log_api_call(trace_id, task, self.name, self.model,
                         f"http_{r.status_code}", t.ms, error=r.text[:200])
            raise LLMError("other", f"{self.name} HTTP {r.status_code}")

        data = r.json()
        usage = data.get("usage", {})
        content = data["choices"][0]["message"]["content"]
        # 部分推理模型输出 <think> 块，剥离
        if "</think>" in content:
            content = content.split("</think>")[-1].strip()
        log_api_call(trace_id, task, self.name, self.model, "success", t.ms,
                     input_tokens=usage.get("prompt_tokens", 0),
                     output_tokens=usage.get("completion_tokens", 0))
        return content


class OfflineProvider(Provider):
    """终极兜底：无任何可用服务商时输出结构化模板。"""

    def __init__(self):
        super().__init__("offline", "", "", "template")

    def available(self) -> bool:
        return True

    def chat(self, messages, task="generic", trace_id=None, **kw) -> str:
        trace_id = trace_id or new_trace_id()
        log_api_call(trace_id, task, "offline", "template", "success", 0)
        user = next((m["content"] for m in reversed(messages)
                     if m["role"] == "user"), "")
        if task == "parse":
            # 离线论点解析：直接取原句作为 core_claim
            arg = user.split("对方论点：")[-1].split("\n")[0].strip() or user[:100]
            return json.dumps({
                "core_claim": arg, "conditions": [], "negations": [],
                "implicit_target": arg, "attack_surface": ["需要证据支撑"],
            }, ensure_ascii=False)
        if task == "classify":
            return json.dumps({"stance": "empirical", "confidence": 0.3,
                               "reason": "离线模式，无法准确分类"},
                              ensure_ascii=False)
        if task == "summarize":
            text = user[:200]
            return f"[离线摘要] {text}..."
        if task == "ideology":
            return json.dumps({k: 0 for k in (
                "ownership", "political_authority", "imperialism",
                "epistemology", "change_speed", "ethics", "culture",
                "diplomacy", "technology")}, ensure_ascii=False)
        return ("[离线模式] 当前无可用 AI 服务商（未配置 API Key 且 Ollama 未运行）。\n"
                "以下为检索到的相关资料，请人工组织反驳：\n\n" + user[-1500:])


def build_providers() -> dict[str, Provider]:
    """按 config 构建所有服务商实例（含自定义）。"""
    providers: dict[str, Provider] = {}
    for name in ("groq", "gemini", "cerebras", "mistral", "openrouter"):
        providers[name] = Provider(name, config.PROVIDER_URLS[name],
                                   config.PROVIDER_KEYS.get(name, ""),
                                   config.PROVIDER_MODELS[name])
    providers["ollama"] = Provider("ollama", config.PROVIDER_URLS["ollama"],
                                   "", config.PROVIDER_MODELS["ollama"])
    try:
        for c in json.loads(config.CUSTOM_PROVIDERS_JSON):
            providers[c["name"]] = Provider(c["name"], c["url"],
                                            c.get("key", ""), c["model"])
    except (json.JSONDecodeError, KeyError):
        pass
    providers["offline"] = OfflineProvider()
    return providers
