"""设置端点（项目7/13）：服务商 Key 配置 + 热重载，供桌面设置页调用。

安全约定：GET 永不回传 Key 明文，只回传是否已配置。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models.model_router import get_router, reset_router

router = APIRouter(prefix="/api", tags=["settings"])

_ENV_KEY_NAMES = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY",
                  "cerebras": "CEREBRAS_API_KEY",
                  "mistral": "MISTRAL_API_KEY",
                  "openrouter": "OPENROUTER_API_KEY"}


def _env_file_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / ".env"
    return config.BACKEND_DIR / ".env"


class KeyRequest(BaseModel):
    provider: str = Field(min_length=1)
    key: str = Field(min_length=1, max_length=500)


@router.get("/config/providers")
def list_providers():
    """各服务商配置状态（不回传明文）+ 默认模型 + 实际可用性。"""
    health = get_router().health()
    return {"default_provider": config.DEFAULT_PROVIDER,
            "providers": [
                {"name": name,
                 "configured": bool(config.PROVIDER_KEYS.get(name)),
                 "available": health.get(name, False),
                 "model": config.PROVIDER_MODELS.get(name, "")}
                for name in _ENV_KEY_NAMES] + [
                {"name": "ollama", "configured": True,
                 "available": health.get("ollama", False),
                 "model": config.PROVIDER_MODELS.get("ollama", "")}]}


@router.post("/config/key")
def set_key(req: KeyRequest):
    """写 Key 到 .env + 进程内热重载 + 重建路由器（立即生效免重启）。"""
    key_name = _ENV_KEY_NAMES.get(req.provider)
    if not key_name:
        raise HTTPException(422,
                            f"未知服务商 {req.provider}，"
                            f"可选: {list(_ENV_KEY_NAMES)}")
    env = _env_file_path()
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [ln for ln in lines if not ln.startswith(key_name + "=")]
    lines.append(f"{key_name}={req.key}")
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key_name] = req.key
    config.PROVIDER_KEYS[req.provider] = req.key
    reset_router()
    return {"provider": req.provider, "configured": True,
            "env_path": str(env)}


@router.delete("/config/key/{provider}")
def delete_key(provider: str):
    """移除 Key（.env 删行 + 进程内清空）。"""
    key_name = _ENV_KEY_NAMES.get(provider)
    if not key_name:
        raise HTTPException(422, f"未知服务商 {provider}")
    env = _env_file_path()
    if env.exists():
        lines = [ln for ln in env.read_text(encoding="utf-8").splitlines()
                 if not ln.startswith(key_name + "=")]
        env.write_text("\n".join(lines) + ("\n" if lines else ""),
                       encoding="utf-8")
    os.environ.pop(key_name, None)
    config.PROVIDER_KEYS[provider] = ""
    reset_router()
    return {"provider": provider, "configured": False}


# ---------- 0.1.2 扩展（项目23）：任务链总览 / 自定义服务商 / 参数 / 连通测试 ----------

# 任务用途说明（设置页「模型为了实现什么功能」）
_TASK_LABELS = {"summarize": "文档摘要与入库整理",
                "ideology": "22轴意识形态坐标分析",
                "rebuttal": "反驳/批判/评价生成",
                "parse": "对方论点结构解析",
                "classify": "立场分类与关系判定"}


@router.get("/config/tasks")
def task_overview():
    """任务分工总览：每任务的优先级链 + 当前实际落点（全不可用=离线兜底）。"""
    r = get_router()
    health = r.health()
    chains = config.effective_task_chains()
    out = []
    for task, chain in chains.items():
        active = next((n for n in chain
                       if n in r.providers and health.get(n)), "offline")
        out.append({"task": task, "label": _TASK_LABELS.get(task, task),
                    "chain": chain, "active": active})
    return {"tasks": out,
            "all_offline": all(t["active"] == "offline" for t in out)}


class CustomProvider(BaseModel):
    name: str = Field(min_length=1, max_length=40,
                      pattern="^[A-Za-z0-9_-]+$")
    url: str = Field(min_length=8, max_length=300)
    key: str = Field(default="", max_length=500)
    model: str = Field(min_length=1, max_length=120)
    tasks: list[str] = Field(default_factory=list)


_BUILTIN_NAMES = set(_ENV_KEY_NAMES) | {"ollama", "offline"}


@router.get("/config/custom-providers")
def list_custom_providers():
    """自定义服务商列表（Key 只回传是否已配置）。"""
    return {"providers": [{**{k: c.get(k, "") for k in
                              ("name", "url", "model")},
                           "tasks": c.get("tasks") or [],
                           "has_key": bool(c.get("key"))}
                          for c in config.effective_custom_providers()]}


@router.post("/config/custom-providers")
def add_custom_provider(req: CustomProvider):
    """新增/更新 OpenAI 兼容自定义服务商，写 settings.json + 热重建路由。
    tasks 指定要加入哪些任务链（插到链首）。"""
    if req.name in _BUILTIN_NAMES:
        raise HTTPException(422, f"{req.name} 是内置服务商名，不可占用")
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(422, "BaseURL 必须以 http(s):// 开头")
    provs = [c for c in config.effective_custom_providers()
             if c.get("name") != req.name]
    provs.append({"name": req.name, "url": req.url, "key": req.key,
                  "model": req.model, "tasks": req.tasks})
    s = config.load_settings()
    chains = s.get("task_chains") or {}
    for task in req.tasks:
        if task in config.TASK_CHAINS:
            base = chains.get(task) or list(config.TASK_CHAINS[task])
            chains[task] = [req.name] + [n for n in base if n != req.name]
    config.save_settings({"custom_providers": provs, "task_chains": chains})
    reset_router()
    return {"ok": True, "name": req.name}


@router.delete("/config/custom-providers/{name}")
def delete_custom_provider(name: str):
    provs = config.effective_custom_providers()
    kept = [c for c in provs if c.get("name") != name]
    if len(kept) == len(provs):
        raise HTTPException(404, "自定义服务商不存在")
    s = config.load_settings()
    chains = {t: [n for n in chain if n != name]
              for t, chain in (s.get("task_chains") or {}).items()}
    config.save_settings({"custom_providers": kept, "task_chains": chains})
    reset_router()
    return {"ok": True}


class ParamsPatch(BaseModel):
    retrieval_top_k: int | None = Field(default=None, ge=1, le=20)
    retrieval_top_k_coarse: int | None = Field(default=None, ge=5, le=100)
    full_context_token_limit: int | None = Field(default=None,
                                                 ge=1000, le=500000)


@router.get("/config/params")
def get_params():
    return {"retrieval_top_k": config.RETRIEVAL_TOP_K_FINAL,
            "retrieval_top_k_coarse": config.RETRIEVAL_TOP_K_COARSE,
            "full_context_token_limit": config.FULL_CONTEXT_TOKEN_LIMIT}


@router.patch("/config/params")
def patch_params(req: ParamsPatch):
    """生成与检索参数：写 settings.json 并热生效（项目23-B）。"""
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(422, "没有要修改的参数")
    config.save_settings(patch)
    config.apply_settings()
    return get_params()


@router.post("/config/test/{provider}")
def test_provider(provider: str):
    """连通测试：真实发一条 1-token 请求，报可用/错误原因。"""
    r = get_router()
    p = r.providers.get(provider)
    if p is None:
        raise HTTPException(404, f"服务商 {provider} 不存在")
    try:
        p.chat([{"role": "user", "content": "ping"}], task="classify",
               max_tokens=5, timeout=15.0)
        return {"provider": provider, "ok": True}
    except Exception as e:  # noqa: BLE001 测试端点要把失败原因带回给用户
        return {"provider": provider, "ok": False, "error": str(e)[:300]}


class ModelsProbe(BaseModel):
    url: str = Field(min_length=8, max_length=300)
    key: str = ""


@router.post("/config/models-probe")
def models_probe(req: ModelsProbe):
    """拉取 OpenAI 兼容服务商的可用模型清单（GET {url}/models），
    供设置页下拉选择；失败时前端回退手动输入。"""
    import httpx
    url = req.url.rstrip("/")
    headers = {"Authorization": f"Bearer {req.key}"} if req.key else {}
    try:
        try:
            r = httpx.get(f"{url}/models", headers=headers, timeout=10.0)
        except httpx.ConnectError as e:
            if "SSL" not in str(e) and "CERTIFICATE" not in str(e).upper():
                raise
            r = httpx.get(f"{url}/models", headers=headers, timeout=10.0,
                          verify=False)  # 证书审查代理环境降级
        if r.status_code != 200:
            return {"ok": False, "models": [],
                    "error": f"HTTP {r.status_code}: {r.text[:120]}"}
        data = r.json().get("data", [])
        ids = sorted({m.get("id") for m in data if m.get("id")})
        return {"ok": True, "models": list(ids)}
    except Exception as e:  # noqa: BLE001 探测失败要带回原因
        return {"ok": False, "models": [], "error": str(e)[:200]}


class ModelOverride(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=120)


@router.patch("/config/model-override")
def model_override(req: ModelOverride):
    """内置服务商默认模型覆盖（写 settings.json + 热重建路由）。"""
    if req.provider not in config.PROVIDER_MODELS:
        raise HTTPException(422,
                            f"未知内置服务商 {req.provider}，"
                            f"可选: {list(config.PROVIDER_MODELS)}")
    overrides = config.load_settings().get("provider_models") or {}
    overrides[req.provider] = req.model
    config.save_settings({"provider_models": overrides})
    reset_router()
    return {"provider": req.provider, "model": req.model}
