"""诊断接口：GET /api/health（依赖健康检查）。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from api.deps import get_db, get_engine
from models.embedder import embedder_status
from models.model_router import get_router
from storage.skill_loader import get_skill_loader

router = APIRouter(prefix="/api", tags=["diagnostics"])


@router.get("/health")
def health():
    db_ok, vec_count = True, -1
    try:
        stats = get_db().stats()
        vec_count = get_engine().chain.retriever.vec.count()
    except Exception as e:
        db_ok, stats = False, {"error": str(e)}
    skills = get_skill_loader()
    return {
        "status": "ok" if db_ok else "degraded",
        "version": config.VERSION,
        "sqlite": {"ok": db_ok, "path": str(config.SQLITE_PATH), **(
            stats if isinstance(stats, dict) else {})},
        "vector_store": {"count": vec_count},
        "embedder": embedder_status(),
        "providers": get_router().health(),
        "skills": {"stances": len(skills.stances(reload=True)),
                   "ingestion": len(skills.ingestion(reload=True))},
    }


@router.get("/diagnostics/connectivity")
def connectivity():
    """一键连通自测（0.1.3 B9）：模型链 / 维基百科 / 百度百科 / 代理配置。
    每项独立超时，互不阻塞；结果供设置页诊断区表格展示。"""
    import httpx
    out: list[dict] = []

    # 1) 模型链：每任务当前落点（offline = 全链不可用）
    r = get_router()
    health_map = r.health()
    chains = config.effective_task_chains()
    offline_tasks = [t for t, chain in chains.items()
                     if not any(health_map.get(n) for n in chain)]
    out.append({"item": "模型链", "ok": not offline_tasks,
                "detail": ("全部任务有可用服务商" if not offline_tasks else
                           f"落离线兜底的任务：{'、'.join(offline_tasks)}")})

    # 2/3) 维基百科 / 百度百科（走代理三态 + SSL 降级，各 3 秒）
    for name, url in (("维基百科", "https://zh.wikipedia.org/api/rest_v1/page/summary/%E5%93%B2%E5%AD%A6"),
                      ("百度百科", "https://baike.baidu.com/item/%E5%93%B2%E5%AD%A6")):
        try:
            kw = {"timeout": 3.0, "follow_redirects": True,
                  "proxy": config.httpx_proxy_for(url),
                  "trust_env": config.httpx_trust_env_for(url),
                  "headers": {"User-Agent": "Mozilla/5.0 DebateEngine"}}
            try:
                resp = httpx.get(url, **kw)
            except httpx.ConnectError as e:
                if "SSL" not in str(e) and "CERTIFICATE" not in str(e).upper():
                    raise
                resp = httpx.get(url, verify=False, **kw)
            out.append({"item": name, "ok": resp.status_code < 500,
                        "detail": f"HTTP {resp.status_code}"})
        except Exception as e:  # noqa: BLE001 诊断端点要把原因带回
            out.append({"item": name, "ok": False,
                        "detail": f"连接失败（{type(e).__name__}）"})

    # 4) 代理配置状态
    p = config.proxy_config()
    out.append({"item": "代理", "ok": True,
                "detail": {"off": "未启用（直连）",
                           "system": "跟随系统代理",
                           "custom": f"自定义：{p['url'] or '（未填地址）'}"}[p["mode"]]})
    return {"checks": out}
