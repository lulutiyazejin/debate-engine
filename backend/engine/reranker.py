"""Reranker：立场权重加权 + 无关块过滤 → Top-5。

并提供 RetrievalChain 门面：解析 → 立场路由 → 混合检索 → 精排 一步到位。
0.1.1（项目8）：搜索模式 keyword|semantic|hybrid|smart；
免费质量评分：上下文相关性 = Top-5 向量相似度均值（写入检索日志）。
0.1.1（项目10）：可选中心点参照加权（centers.md），默认无偏移。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import Timer, log_retrieval, new_trace_id
from engine.argument_parser import parse_argument
from engine.retriever import HybridRetriever
from engine.stance_router import StanceRouter
from models.embedder import get_embedder
from models.model_router import ModelRouter, get_router
from storage.lance_store import VectorStoreBase
from storage.skill_loader import get_skill_loader
from storage.sqlite_store import SqliteStore

_REWRITE_PROMPT = (
    "把以下辩论论点改写成适合知识库检索的关键词查询（只输出一行，8-25字，"
    "保留核心概念去掉语气词）：\n{q}")


def context_relevance(query_text: str, chunks: list[dict]) -> float:
    """免费评分维度一：Top-K 块与查询的向量余弦均值（RAGAS 思路）。"""
    if not chunks or not query_text:
        return 0.0
    emb = get_embedder()
    vecs = emb.embed_batch([query_text] +
                           [c.get("text", "")[:800] for c in chunks])
    q = np.asarray(vecs[0], dtype=np.float32)
    sims = []
    for v in vecs[1:]:
        v = np.asarray(v, dtype=np.float32)
        sims.append(float(q @ v / (np.linalg.norm(q) * np.linalg.norm(v) + 1e-9)))
    return round(sum(sims) / len(sims), 4)


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


def _center_weight(doc_coords: dict, center_coords: dict) -> float:
    """中心点参照加权（项目10）：距中心近的文档最高 +20%，远的最低 -20%。"""
    axes = [k for k, v in center_coords.items() if isinstance(v, (int, float))]
    if not axes or not doc_coords:
        return 1.0
    total = 0.0
    for a in axes:
        try:
            total += abs(float(doc_coords.get(a, 0)) - float(center_coords[a]))
        except (TypeError, ValueError):
            total += 0.0
    norm = total / (10.0 * len(axes))   # 0=重合 1=最远
    return 1.0 + (0.5 - norm) * 0.4


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
            trace_id: str | None = None, mode: str = "hybrid",
            center: str | None = None) -> dict:
        """mode: keyword|semantic|hybrid|smart（smart=先 LLM 查询改写再 hybrid）；
        center: centers.md 预设键名，以该点为参照加权（默认无偏移）。"""
        trace_id = trace_id or new_trace_id()
        with Timer() as t:
            parsed = parse_argument(argument, router=self.llm_router,
                                    trace_id=trace_id)
            query = parsed["implicit_target"]
            search_mode = mode
            if mode == "smart":
                r = self.llm_router or get_router()
                out, prov = r.run(
                    "parse",
                    [{"role": "user",
                      "content": _REWRITE_PROMPT.format(q=argument[:500])}],
                    trace_id=trace_id, max_tokens=100, temperature=0.1)
                if prov != "offline" and out.strip():
                    query = out.strip().splitlines()[0][:100]
                search_mode = "hybrid"   # 改写失败也回落 hybrid
            route = self.stance_router.route(stance)
            coarse = self.retriever.retrieve(
                query, parsed["core_claim"],
                doc_ids=route["doc_ids"], mode=search_mode)
            final = rerank(coarse["candidates"], route["weights"], parsed)
            if center:
                cdef = get_skill_loader().centers().get(center)
                if cdef:
                    cache: dict[str, dict] = {}
                    for c in final:
                        did = c["doc_id"]
                        if did not in cache:
                            row = self.db.get_document(did) or {}
                            try:
                                prov = json.loads(row.get("provenance") or "{}")
                            except (TypeError, ValueError):
                                prov = {}
                            cache[did] = prov.get("coordinates", {}) or {}
                        w = _center_weight(cache[did], cdef["coords"])
                        c["final_score"] *= w
                        c["center_weight"] = round(w, 3)
                    final.sort(key=lambda x: -x["final_score"])
        top_score = final[0]["final_score"] if final else 0.0
        relevance = context_relevance(query, final)
        log_retrieval(trace_id, argument, stance, style,
                      fts_hits=coarse["fts_hits"],
                      vector_hits=coarse["vector_hits"],
                      final_chunks=len(final), top_score=top_score,
                      retrieval_ms=t.ms, mode=mode,
                      context_relevance=relevance)
        return {"trace_id": trace_id, "parsed_argument": parsed,
                "route": route, "chunks": final,
                "context_relevance": relevance, "mode": mode,
                "retrieval_ms": t.ms}
