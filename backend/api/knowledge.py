"""知识库接口：GET /api/knowledge/docs、GET /api/knowledge/search。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, Query

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_db, get_engine

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("/docs")
def list_docs(stance: str | None = None):
    db = get_db()
    return {"documents": db.list_documents(stance), "stats": db.stats()}


@router.get("/search")
def search(q: str = Query(min_length=1), stance: str = "empirical",
           top_k: int = 5):
    """带立场的混合检索（不生成反驳，仅返回候选块）。"""
    chain = get_engine().chain
    r = chain.run(q, stance)
    return {"query": q, "stance": stance,
            "chunks": [{"chunk_id": c["chunk_id"], "doc_id": c["doc_id"],
                        "score": round(c["final_score"], 6),
                        "text": c["text"][:300]}
                       for c in r["chunks"][:top_k]],
            "excluded_docs": r["route"]["excluded"],
            "retrieval_ms": r["retrieval_ms"]}
