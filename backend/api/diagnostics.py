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
