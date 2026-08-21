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


def ollama_exe_path() -> str | None:
    """0.1.6 hotfix：定位 ollama 可执行文件（PATH + 默认安装目录）。
    安装程序把 PATH 写注册表，当前进程重启前看不见，故直接探目录。"""
    import os
    import shutil
    cmd = shutil.which("ollama")
    if cmd:
        return cmd
    if sys.platform == "win32":
        p = (Path(os.environ.get("LOCALAPPDATA", ""))
             / "Programs" / "Ollama" / "ollama.exe")
        if p.exists():
            return str(p)
    return None


def has_ollama_binary() -> bool:
    """检查本地是否有 ollama 可执行文件。"""
    return ollama_exe_path() is not None


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
    exe = ollama_exe_path()
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


# 0.1.6 hotfix2：安装包多源——GitHub 官方 Release 实测比 ollama.com CDN 稳
#（代理对大文件转发不稳，GitHub 资产 316MB 实测稳过）；latest/download 免追版本号。
OLLAMA_SETUP_URLS = [
    "https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe",
    "https://ollama.com/download/OllamaSetup.exe",
]

_RUNTIME_DL_BUSY = False   # 单飞锁：并发点击不双写 .part（hotfix4 并发 bug）


def install_runtime_stream():
    """0.1.6 hotfix2：Ollama 运行时一键装——多源轮换+断点续传：
    掐线不从头来，.part 保留换源接着下；本地已有完整包则跳过下载；
    Inno 静默安装（免管理员、隐藏窗）；装完由前端接一键启动。"""
    global _RUNTIME_DL_BUSY
    import subprocess
    import tempfile
    import httpx
    if _RUNTIME_DL_BUSY:
        yield {"done": True, "ok": False,
               "detail": "另一个安装任务正在进行，请稍候再试"}
        return
    _RUNTIME_DL_BUSY = True
    tmp = Path(tempfile.gettempdir()) / "OllamaSetup.exe"
    part = tmp.with_name(tmp.name + ".part")
    last_url = OLLAMA_SETUP_URLS[0]
    try:
        if not (tmp.exists() and tmp.stat().st_size > 1 << 20):
            done = part.stat().st_size if part.exists() else 0
            if done:
                yield {"status": f"断点续传（已存 {done // 1048576}MB）…",
                       "percent": 0}
            total_known = 0
            finished = False
            last_err = ""
            for attempt in range(6):   # 两源轮换×3 轮，全程续传
                url = last_url = OLLAMA_SETUP_URLS[attempt % len(OLLAMA_SETUP_URLS)]
                try:
                    headers = {"Range": f"bytes={done}-"} if done else {}
                    with httpx.stream("GET", url, headers=headers,
                                      proxy=config.httpx_proxy_for(url),
                                      trust_env=config.httpx_trust_env_for(url),
                                      follow_redirects=True, timeout=120) as r:
                        r.raise_for_status()
                        if done and r.status_code == 200:
                            done = 0   # 该源不支持续传，从头
                            open(part, "wb").close()
                        total_known = (int(r.headers.get("content-length") or 0)
                                       + done) or total_known
                        src = "GitHub" if "github.com" in url else "官网"
                        with open(part, "ab") as f:
                            for blk in r.iter_bytes(1 << 20):
                                f.write(blk)
                                done += len(blk)
                                if total_known and done % (8 << 20) < (1 << 20):
                                    yield {"percent": round(done * 100 / total_known, 1),
                                           "status": f"{src}源 {done // 1048576}/"
                                                     f"{total_known // 1048576}MB"}
                    if not total_known or done >= total_known:
                        finished = True
                        break
                    last_err = f"{url} → 中途断线（已下 {done // 1048576}MB）"
                except Exception as e:
                    last_err = f"{url} → {e}"
                yield {"status": f"断线换源续传…（{attempt + 1}/6）"}
            if not finished:
                yield {"done": True, "ok": False,
                       "detail": f"下载失败：{last_err}。已下部分保留，"
                                 f"重试将从断点继续"}
                return
            part.replace(tmp)
        yield {"status": "静默安装中（无弹窗）…", "percent": 100}
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        p = subprocess.run([str(tmp), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
                           creationflags=flags, timeout=900,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if p.returncode != 0:
            yield {"done": True, "ok": False,
                   "detail": f"安装程序返回码 {p.returncode}"}
            return
        yield {"done": True, "ok": True,
               "detail": "Ollama 运行时安装完成，正在自动拉起"}
    except Exception as e:
        yield {"done": True, "ok": False, "detail": f"{last_url} → {e}"}
    finally:
        _RUNTIME_DL_BUSY = False


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
