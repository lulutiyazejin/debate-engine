"""本地模型自主端点（PLAN-0.1.5 F2/F3b/F3c/F5/H2）。

GET  /api/config/hardware        硬件探测（nvidia-smi 隐藏窗 + 内存）+ 推荐模型
GET  /api/config/ollama/ctx      上下文档位（自动/手动五档 + 每档显存预估）
PATCH /api/config/ollama/ctx     写档位（settings ollama_ctx，热生效）
POST /api/config/ollama/serve    一键启动 Ollama（注入代理环境变量，隐藏窗）
POST /api/config/ollama/import-gguf  本地 GGUF 导入（全断网兜底）
GET  /api/config/summary-window  摘要任务当前落点窗口（F4/F5 判墙数据源）
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models import model_matrix as mm
from models.model_router import get_router

router = APIRouter(prefix="/api/config", tags=["local-models"])


def _detect_hardware() -> dict:
    """H2：nvidia-smi（CREATE_NO_WINDOW）拿显卡名/显存；ctypes 拿内存总量。
    失败=无独显（文案中性，不贬其他品牌）。"""
    import subprocess
    gpu_name, vram_gb, has_gpu = "", 0.0, False
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, creationflags=flags)
        if out.returncode == 0 and out.stdout.strip():
            line = out.stdout.strip().splitlines()[0]
            name, mem = line.rsplit(",", 1)
            gpu_name, vram_gb = name.strip(), round(float(mem.strip()) / 1024, 1)
            has_gpu = True
    except Exception:
        pass
    ram_gb = 0.0
    try:
        if sys.platform == "win32":
            import ctypes

            class _MemStat(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong),
                            ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = _MemStat()
            st.dwLength = ctypes.sizeof(_MemStat)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            ram_gb = round(st.ullTotalPhys / 1024 ** 3, 1)
        else:
            import os
            ram_gb = round(os.sysconf("SC_PAGE_SIZE")
                           * os.sysconf("SC_PHYS_PAGES") / 1024 ** 3, 1)
    except Exception:
        pass
    rec = mm.recommend_for(vram_gb, has_gpu)
    return {"has_gpu": has_gpu, "gpu_name": gpu_name, "vram_gb": vram_gb,
            "ram_gb": ram_gb, "recommend": rec,
            "note": ("" if has_gpu
                     else "未检测到可用的 NVIDIA 独显；建议以云端服务商为主，"
                          "本地可选轻量模型体验")}


@router.get("/hardware")
def get_hardware(refresh: int = 0):
    """缓存 settings hw_profile；refresh=1 重新探测。"""
    cached = config.load_settings().get("hw_profile")
    if cached and not refresh:
        return cached
    hw = _detect_hardware()
    config.save_settings({"hw_profile": hw})
    return hw


@router.get("/ollama/ctx")
def get_ollama_ctx():
    """F2：档位现状 + 每档显存预估（超探测显存标 tight，不禁止）。"""
    s = config.load_settings()
    cfg = s.get("ollama_ctx") if isinstance(s.get("ollama_ctx"), dict) else {}
    mode = cfg.get("mode") if cfg.get("mode") in ("auto", "manual") else "auto"
    model = config.effective_provider_models().get("ollama", "")
    auto_value = mm.effective_ctx(model) if mode == "auto" else (
        mm.find(model)["auto_ctx"] if mm.find(model) else 8192)
    hw = s.get("hw_profile") or {}
    vram = float(hw.get("vram_gb") or 0)
    gears = []
    for g in mm.CTX_GEARS:
        est = mm.vram_estimate_gb(model, g)
        gears.append({"ctx": g, "vram_gb": est,
                      "tight": bool(vram and est > vram)})
    return {"mode": mode,
            "value": int(cfg.get("value") or 0) or auto_value,
            "auto_value": auto_value, "model": model, "gears": gears,
            "gpu_vram_gb": vram}


class CtxPatch(BaseModel):
    mode: str = Field(pattern="^(auto|manual)$")
    value: int | None = None


@router.patch("/ollama/ctx")
def patch_ollama_ctx(req: CtxPatch):
    if req.mode == "manual" and req.value not in mm.CTX_GEARS:
        raise HTTPException(422, f"手动档位必须是 {mm.CTX_GEARS} 之一")
    config.save_settings({"ollama_ctx": {"mode": req.mode,
                                         "value": req.value or 0}})
    return get_ollama_ctx()


@router.post("/ollama/serve")
def ollama_serve():
    """F3b：一键启动（隐藏窗 + 代理注入），返回启动结果与下载通道。"""
    from ingestion import ollama_adapter as oa
    ok, detail = oa.serve_start()
    return {"ok": ok, "detail": detail, "channel": oa.download_channel()}


class GgufImport(BaseModel):
    path: str = Field(min_length=3)
    name: str = Field(min_length=1, max_length=60,
                      pattern="^[A-Za-z0-9._:-]+$")


@router.post("/ollama/import-gguf")
def ollama_import_gguf(req: GgufImport):
    """F3c：本地 GGUF → ollama create 导入；成功即设为本地默认模型。"""
    from ingestion import ollama_adapter as oa
    from models.model_router import reset_router
    ok, detail = oa.import_gguf(req.path, req.name)
    if ok:
        overrides = config.load_settings().get("provider_models") or {}
        overrides["ollama"] = req.name
        config.save_settings({"provider_models": overrides})
        reset_router()
    return {"ok": ok, "detail": detail}


@router.get("/summary-window")
def summary_window_info():
    """F4/F5：摘要任务当前落点的窗口/余量线/档时 + 云端大窗可用性 + 记忆策略。"""
    from ingestion.summarizer import summary_window
    win, provider, model = summary_window()
    r = get_router()
    chains = config.effective_task_chains().get("summarize", [])
    cloud = next((n for n in chains
                  if n != "ollama" and n in r.providers
                  and r.providers[n].available()), None)
    models = config.effective_provider_models()
    return {"window": win, "provider": provider, "model": model,
            "margin": int(win * 0.9),
            "sec_per_8k": (mm.sec_per_8k(model) if provider == "ollama" else 3),
            "cloud": {"available": bool(cloud), "provider": cloud or "",
                      "model": models.get(cloud, "") if cloud else ""},
            "policy": config.load_settings().get("over_window_policy") or ""}
