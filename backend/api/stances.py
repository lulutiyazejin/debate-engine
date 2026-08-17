"""立场接口：GET /api/stances（已配置立场 + 文档统计）。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_db
from storage.skill_loader import get_skill_loader

router = APIRouter(prefix="/api", tags=["stances"])


@router.get("/stances")
def list_stances():
    loader = get_skill_loader()
    db = get_db()
    docs = db.list_documents()
    counts: dict[str, int] = {}
    for d in docs:
        s = d.get("stance") or "unknown"
        counts[s] = counts.get(s, 0) + 1
    out = []
    for name, skill in loader.stances(reload=True).items():
        out.append({"name": name, "title": skill.title,
                    "default_style": skill.get("默认回复风格", "反驳"),
                    "doc_count": counts.get(name, 0),
                    "retrieval_prefs": skill.retrieval_prefs})
    return {"stances": out, "total_docs": len(docs)}
