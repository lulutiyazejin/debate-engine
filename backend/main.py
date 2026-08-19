"""FastAPI 入口：注册全部路由。运行：python main.py 或 uvicorn main:app。

0.1.1（项目11）：端口冲突自动递增，实际端口写 knowledge_base/.engine_port
供桌面壳握手；POST /api/shutdown 供桌面壳退出时优雅关停引擎。
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
config.mount_extras()   # 组件中心（0.1.4）：已装组件包先挂 sys.path 再注册路由
from api import (analysis, components, diagnostics, files, import_doc,
                 kb_package, knowledge, rebuttal, settings, stances, workspace)
from applog import log_system


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    log_system("api_startup", host=config.API_HOST, port=config.API_PORT)
    yield


app = FastAPI(title="Debate Engine API", version=config.VERSION,
              lifespan=lifespan)
# 桌面壳 WebView（tauri://localhost）跨源访问；服务只绑 127.0.0.1，风险可控
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(rebuttal.router)
app.include_router(import_doc.router)
app.include_router(components.router)
app.include_router(files.router)
app.include_router(knowledge.router)
app.include_router(settings.router)
app.include_router(kb_package.router)
app.include_router(analysis.router)
app.include_router(stances.router)
app.include_router(diagnostics.router)
app.include_router(workspace.router)

# 0.1.3 D12：字体外挂——knowledge_base/fonts 放 ttf/otf/woff2 即放即用，
# 不随安装包分发字体（体积红线），前端启动时注册 FontFace。
_FONTS_DIR = config.KNOWLEDGE_BASE_PATH / "fonts"
_FONTS_DIR.mkdir(parents=True, exist_ok=True)
from fastapi.staticfiles import StaticFiles  # noqa: E402
app.mount("/fonts", StaticFiles(directory=str(_FONTS_DIR)), name="fonts")


@app.get("/api/fonts")
def list_fonts():
    exts = {".ttf", ".otf", ".woff", ".woff2"}
    return {"fonts": sorted(f.name for f in _FONTS_DIR.iterdir()
                            if f.is_file() and f.suffix.lower() in exts)}


@app.post("/api/shutdown")
def shutdown():
    """桌面壳退出时调用：延迟自杀，先让响应返回。"""
    log_system("api_shutdown")

    def _die():
        time.sleep(0.3)
        os._exit(0)

    threading.Thread(target=_die, daemon=True).start()
    return {"bye": True}


def _pick_port(host: str, start: int, tries: int = 20) -> int:
    """从 start 起逐个试绑，返回首个可用端口。"""
    for p in range(start, start + tries):
        with socket.socket() as s:
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    raise RuntimeError(f"{start}-{start + tries - 1} 无可用端口")


def port_file_path() -> Path:
    return config.KNOWLEDGE_BASE_PATH / ".engine_port"


def _watch_parent() -> None:
    """父进程看门狗（项目11 双保险第二道）：桌面壳崩溃/被强杀时，
    优雅关停链路不会执行，引擎靠等待父进程句柄自杀，避免孤儿进程。"""
    ppid = int(os.getenv("DEBATE_PARENT_PID", "0") or 0)
    if not ppid or os.name != "nt":
        return
    import ctypes
    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(0x0010_0000, False, ppid)   # SYNCHRONIZE
    if not handle:
        return

    def _wait() -> None:
        k32.WaitForSingleObject(handle, 0xFFFFFFFF)
        log_system("parent_gone_exit", ppid=ppid)
        os._exit(0)

    threading.Thread(target=_wait, daemon=True).start()


def serve_forever() -> None:
    """就绪信号：实际端口写 .engine_port（含 PID），桌面壳轮询此文件 + health。"""
    import uvicorn
    config.ensure_dirs()
    _watch_parent()
    port = _pick_port(config.API_HOST, config.API_PORT)
    port_file_path().write_text(f"{port}\n{os.getpid()}", encoding="utf-8")
    log_system("api_listen", port=port, pid=os.getpid())
    uvicorn.run(app, host=config.API_HOST, port=port, log_level="warning")


if __name__ == "__main__":
    serve_forever()
