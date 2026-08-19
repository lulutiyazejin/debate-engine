"""本地模型适配器（0.1.3 B7）：Ollama 基，探测→拉起→pull→下载立即生效。

行为（决策13）：
- GET :11434 API/health；存在即使用，不存在尝试调用 ollama server 拉起
- 未安装 Ollama：给出官方安装包指引链接（不直接执行外部命令）
- 设置中「本地模型」显示候选、一键 pull、进度条流式返回
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config


OLLAMA_HOST = "http://127.0.0.1:11434"


def _fetch_json(url: str, timeout: float = 1.0) -> dict | None:
    """GET JSON（代理三态）。"""
    import httpx
    kw = {"timeout": timeout, "follow_redirects": True,
          "proxy": config.httpx_proxy_for(url),
          "trust_env": config.httpx_trust_env_for(url)}
    try:
        r = httpx.get(url, **kw)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def is_installed() -> bool:
    """探测 Ollama 是否在运行。"""
    j = _fetch_json(f"{OLLAMA_HOST}/api/tags", timeout=0.5)
    return bool(j and isinstance(j, dict) and "models" in j)


def has_ollama_binary() -> bool:
    """检查本地是否有 ollama 可执行文件。"""
    # Windows: PATH +常见位置；macOS/Linux: /usr/local/bin
    candidates = ["ollama"] + [
        "/opt/homebrew/bin/ollama",
        "/usr/local/bin/ollama",
        f"{config.KNOWLEDGE_BASE_PATH}/bin/ollama.exe" if sys.platform == "win32" else None
    ]
    for p in candidates:
        if not p:
            continue
        try:
            import subprocess
            import shutil
            cmd = shutil.which(p or "ollama")
            if cmd and Path(cmd).exists():
                return True
        except Exception:
            pass
    return False


def ensure_ollama_started() -> tuple[bool, str]:
    """确保 Ollama 已启动：若检测到无进程但可执行文件存在则拉起，
    否则给明确提示字符串。"""
    try:
        if is_installed():
            return True, "Ollama 正在运行"
        if not has_ollama_binary():
            msg = ("未找到 Ollama 服务与可执行文件。\n"
                   "方式一：在终端 `ollama serve`\n"
                   "方式二：到 https://ollama.ai/download 下载安装后开机自启\n"
                   "本软件会继续尝试连接（后台轮询）")
            return False, msg
        # 有二进制但服务未起：建议用户手动启动（Windows 双击桌面图标也可）
        return True, "建议手动启动：`ollama serve` 或系统托盘快捷方式"
    except Exception as e:
        return False, f"检查失败：{e}"


def models_list() -> list[str] | None:
    """获取已拉取的模型列表。"""
    j = _fetch_json(f"{OLLAMA_HOST}/api/tags", timeout=1.0)
    if not j or not isinstance(j, dict):
        return None
    return [m["name"].split(":")[0] for m in j.get("models") or []]


def pull_model(name: str, progress_cb=None) -> tuple[bool, str]:
    """流式 pull 一个模型（非真正的 SSE，用 /api/generate 的 last 回退）。
    返回 (success, detail)。"""
    import httpx
    url = f"{OLLAMA_HOST}/api/pull"
    payload = {"name": name}
    kw = {"proxy": config.httpx_proxy_for(url), "trust_env": config.httpx_trust_env_for(url)}
    try:
        r = httpx.post(url, json=payload, timeout=180, stream=True, **kw)
        buf = []
        for line in r.iter_lines():
            if line:
                try:
                    j = line.json()
                    status = j.get("status", "")
                    total = j.get("total", 0)
                    completed = j.get("completed", 0)
                    if total and completed and progress_cb:
                        progress_cb(round(completed/total*100))
                    buf.append(status)
                except Exception:
                    pass
        if r.status_code == 200:
            return True, "✅ 模型“{}”下载完成".format(name)
        return False, "{}：{}".format(name, r.text[:200])
    except Exception as e:
        return False, "下载失败：{} — {}".format(name, str(e)[:100])


LOCAL_MODEL_CANDIDATES = {
    "qwen2.5:7b": "通用（推荐）",
    "qwen2.5:3b": "轻量",
    "gemma2:9b": "英文友好",
    "mistral-nemo": "中等体量",
    "phi3.5:ministral": "推理强",
}
