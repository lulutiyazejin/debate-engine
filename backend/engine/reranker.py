"""Reranker：立场权重加权 + 无关块过滤 → Top-5。

并提供 RetrievalChain 门面：解析 → 立场路由 → 混合检索 → 精排 一步到位。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import Timer, log_retrieval, new_trace_id
from engine.argument_parser import parse_argument
from engine.retriever import HybridRetriever
from engine.stance_router import StanceRouter
from models.model_router import ModelRouter
from storage.lance_store import VectorStoreBase
from storage.sqlite_store import SqliteStore


def rerank(candidates: list[dict], weights: dict[str, float],
           parsed_arg: dict | None = None,
           top_k: int = config.RETRIEVAL_TOP_K_FINAL) -> list[dict]:
    """立场加权 + 条件/否定冲突降权 → Top-K。"""
    out = []
    negations = (parsed_arg or {}).get("negations", [])
    for c in candidates:
        w = weights.get(c["doc_id"], 1.0)
        score = c["score"] * w
        # 命中论点否定成分本身而非目标观点的块，轻度降权（避免自我论证）
        if negations and all(n in c.get("text", "") for n in negations[:2] if n):
            score *= 0.8
        out.append({**c, "final_score": score, "stance_weight": w})
    out.sort(key=lambda x: -x["final_score"])
    return out[:top_k]


class RetrievalChain:
    """核心检索链门面：论点 → Top-5 带立场权重的候选块。"""

    def __init__(self, sqlite: SqliteStore | None = None,
                 vectors: VectorStoreBase | None = None,
                 router: ModelRouter | None = None):
        self.db = sqlite or SqliteStore()
        self.stance_router = StanceRouter(sqlite=self.db)
        self.retriever = HybridRetriever(sqlite=self.db, vectors=vectors)
        self.llm_router = router

    def run(self, argument: str, stance: str, style: str = "rebuttal",
            trace_id: str | None = None) -> dict:
        trace_id = trace_id or new_trace_id()
        with Timer() as t:
            parsed = parse_argument(argument, router=self.llm_router,
                                    trace_id=trace_id)
            route = self.stance_router.route(stance)
            coarse = self.retriever.retrieve(
                parsed["implicit_target"], parsed["core_claim"],
                doc_ids=route["doc_ids"])
            final = rerank(coarse["candidates"], route["weights"], parsed)
        top_score = final[0]["final_score"] if final else 0.0
        log_retrieval(trace_id, argument, stance, style,
                      fts_hits=coarse["fts_hits"],
                      vector_hits=coarse["vector_hits"],
                      final_chunks=len(final), top_score=top_score,
                      retrieval_ms=t.ms)
        return {"trace_id": trace_id, "parsed_argument": parsed,
                "route": route, "chunks": final,
                "retrieval_ms": t.ms}
