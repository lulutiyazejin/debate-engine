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
