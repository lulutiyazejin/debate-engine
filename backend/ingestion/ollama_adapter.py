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


def runtime_version() -> str | None:
    """0.1.5 G2：读 Ollama 运行时版本（/api/version），供矩阵 min_runtime 比对。"""
    j = _fetch_json(f"{OLLAMA_HOST}/api/version", timeout=1.0)
    if isinstance(j, dict) and j.get("version"):
        return str(j["version"])
    return None


_SERVE_PROC = None   # 一键拉起的子进程句柄（随引擎生命周期）


def download_channel() -> dict:
    """0.1.5 F3b：下载通道事实——真正的模型下载发生在 Ollama 进程内，
    只有经本软件拉起（注入代理环境变量）的实例才走代理。
    0.1.6 项 1：system 模式显示解析后的真实地址，未设=直连不误导。"""
    cfg = config.proxy_config()
    via = _SERVE_PROC is not None and _SERVE_PROC.poll() is None
    if cfg["mode"] == "custom" and cfg["url"] and via:
        return {"mode": "proxy", "detail": cfg["url"]}
    if cfg["mode"] == "system" and via:
        sp = config.system_proxy_url()
        return {"mode": "system",
                "detail": (f"跟随系统代理 {sp}" if sp
                           else "跟随系统代理（当前系统未设代理=直连）")}
    return {"mode": "direct", "detail": "直连"}


def serve_start() -> tuple[bool, str]:
    """0.1.5 F3b：一键启动 Ollama——子进程 `ollama serve` 注入
    HTTPS_PROXY/HTTP_PROXY=代理三态地址，CREATE_NO_WINDOW 隐藏窗（记忆公约）。"""
    global _SERVE_PROC
    import os
    import shutil
    import subprocess
    import time
    if is_installed():
        return True, "Ollama 已在运行（若需代理下载，请先退出它再由本软件拉起）"
    exe = shutil.which("ollama")
    if not exe:
        return False, "未找到 ollama 可执行文件，请先安装：https://ollama.ai/download"
    env = dict(os.environ)
    cfg = config.proxy_config()
    # 0.1.6 项 1：Ollama pull 只认 HTTPS_PROXY（官方 FAQ），HTTP_PROXY 无用
    # 且可能干扰客户端连接；一律先清残留再按三态写入。
    env.pop("HTTPS_PROXY", None)
    env.pop("HTTP_PROXY", None)
    if cfg["mode"] == "custom" and cfg["url"]:
        env["HTTPS_PROXY"] = cfg["url"]
    elif cfg["mode"] == "system":
        sp = config.system_proxy_url()
        if sp:
            env["HTTPS_PROXY"] = sp
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        _SERVE_PROC = subprocess.Popen([exe, "serve"], env=env,
                                       stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL,
                                       creationflags=flags)
    except OSError as e:
        return False, f"拉起失败：{e}"
    for _ in range(20):   # 最多等 10s 就绪
        time.sleep(0.5)
        if is_installed():
            ch = download_channel()
            return True, f"Ollama 已启动（下载通道：{ch['detail']}）"
    return False, "已拉起但 10 秒内未就绪，请稍后刷新状态"


def import_gguf(path: str, name: str) -> tuple[bool, str]:
    """0.1.5 F3c：本地 GGUF 导入——写临时 Modelfile 后 `ollama create`，
    全断网保底；隐藏窗执行。"""
    import subprocess
    import tempfile
    p = Path(path)
    if not p.exists() or p.suffix.lower() != ".gguf":
        return False, f"文件不存在或不是 .gguf：{path}"
    import shutil
    exe = shutil.which("ollama")
    if not exe:
        return False, "未找到 ollama 可执行文件"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with tempfile.NamedTemporaryFile("w", suffix=".Modelfile", delete=False,
                                     encoding="utf-8") as f:
        f.write(f"FROM {p}\n")
        mf = f.name
    try:
        r = subprocess.run([exe, "create", name, "-f", mf],
                           capture_output=True, text=True, timeout=1800,
                           creationflags=flags)
        if r.returncode == 0:
            return True, f"已导入为本地模型 {name}"
        return False, (r.stderr or r.stdout or "导入失败")[:300]
    except subprocess.TimeoutExpired:
        return False, "导入超时（30 分钟）"
    finally:
        Path(mf).unlink(missing_ok=True)


def pull_stream(name: str):
    """流式 pull（B7）：逐行读 Ollama /api/pull 的 NDJSON，产出
    {status, percent} 进度事件，最后产出 {done, ok, detail} 收尾事件。"""
    import json

    import httpx
    url = f"{OLLAMA_HOST}/api/pull"
    kw = {"proxy": config.httpx_proxy_for(url),
          "trust_env": config.httpx_trust_env_for(url)}
    try:
        with httpx.Client(timeout=httpx.Timeout(1800, connect=5), **kw) as c:
            with c.stream("POST", url, json={"name": name}) as r:
                if r.status_code != 200:
                    r.read()
                    yield {"done": True, "ok": False,
                           "detail": f"HTTP {r.status_code}: {r.text[:200]}"}
                    return
                ok = False
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        j = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if j.get("error"):
                        yield {"done": True, "ok": False,
                               "detail": str(j["error"])[:200]}
                        return
                    status = j.get("status", "")
                    total, completed = j.get("total", 0), j.get("completed", 0)
                    pct = round(completed / total * 100) if total else None
                    if status == "success":
                        ok = True
                    yield {"status": status, "percent": pct}
                yield {"done": True, "ok": ok,
                       "detail": (f"模型 {name} 下载完成" if ok
                                  else "下载中断（未收到 success）")}
    except Exception as e:  # noqa: BLE001 网络类异常统一收尾报告
        yield {"done": True, "ok": False,
               "detail": f"下载失败：{type(e).__name__} {str(e)[:120]}"}


def pull_model(name: str, progress_cb=None) -> tuple[bool, str]:
    """同步封装（测试/CLI 用）：消费 pull_stream 到收尾事件。"""
    final = {"ok": False, "detail": "未开始"}
    for evt in pull_stream(name):
        if evt.get("done"):
            final = evt
            break
        if progress_cb and evt.get("percent") is not None:
            progress_cb(evt["percent"])
    return bool(final.get("ok")), str(final.get("detail", ""))


# 0.1.5 F1/G2：精选卡清单改读模型矩阵（单一真源）；
# 「其他模型」自由输入在 UI 层，pull 端点无白名单限制。
def candidates() -> list[dict]:
    from models.model_matrix import MATRIX
    return [dict(m) for m in MATRIX]
