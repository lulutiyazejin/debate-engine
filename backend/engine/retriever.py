"""Hybrid Retrieval：LanceDB 向量 + FTS5 全文 → RRF 融合 → Top-30 候选。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models.embedder import get_embedder
from storage.lance_store import VectorStoreBase, get_vector_store
from storage.sqlite_store import SqliteStore


def rrf_fuse(vector_hits: list[dict], fts_hits: list[dict],
             k: int = config.RRF_K) -> list[dict]:
    """RRF 融合：score = Σ 1/(k+rank)。输入各自已按相关度降序。"""
    scores: dict[str, float] = {}
    doc_of: dict[str, str] = {}
    for rank, h in enumerate(vector_hits, start=1):
        scores[h["chunk_id"]] = scores.get(h["chunk_id"], 0) + 1 / (k + rank)
        doc_of[h["chunk_id"]] = h["doc_id"]
    for rank, h in enumerate(fts_hits, start=1):
        scores[h["chunk_id"]] = scores.get(h["chunk_id"], 0) + 1 / (k + rank)
        doc_of[h["chunk_id"]] = h["doc_id"]
    fused = [{"chunk_id": cid, "doc_id": doc_of[cid], "score": s}
             for cid, s in scores.items()]
    fused.sort(key=lambda x: -x["score"])
    return fused


class HybridRetriever:
    def __init__(self, sqlite: SqliteStore | None = None,
                 vectors: VectorStoreBase | None = None):
        self.db = sqlite or SqliteStore()
        self.vec = vectors or get_vector_store()

    def retrieve(self, implicit_target: str, core_claim: str,
                 doc_ids: list[str] | None = None,
                 top_k: int = 30, mode: str = "hybrid") -> dict:
        """双路粗检索 + RRF。返回 {candidates: [...], fts_hits, vector_hits}。
        doc_ids 为 None 表示不过滤；为空列表表示无可检索文档（直接空结果）。
        mode（项目8）: keyword=仅 FTS5 / semantic=仅向量 / hybrid=RRF 双路。"""
        if doc_ids is not None and not doc_ids:
            return {"candidates": [], "fts_hits": 0, "vector_hits": 0}

        v_hits: list[dict] = []
        f_hits: list[dict] = []
        if mode != "keyword":
            emb = get_embedder()
            qvec = emb.embed(implicit_target or core_claim)
            v_hits = self.vec.search(qvec, top_k=config.RETRIEVAL_TOP_K_COARSE,
                                     doc_ids=doc_ids)
        if mode != "semantic":
            f_hits = self.db.fts_search(core_claim or implicit_target,
                                        top_k=config.RETRIEVAL_TOP_K_COARSE,
                                        doc_ids=doc_ids)
        # 0.1.8 M2：待审文档不参与检索（双路命中后统一剔除）
        pending = self.db.pending_doc_ids()
        if pending:
            v_hits = [h for h in v_hits if h["doc_id"] not in pending]
            f_hits = [h for h in f_hits if h["doc_id"] not in pending]
        fused = rrf_fuse(v_hits, f_hits)[:top_k]
        # 附全文与元数据
        for c in fused:
            row = self.db.get_chunk(c["chunk_id"])
            if row:
                c["text"] = row["text"]
                c["page_range"] = row.get("page_range") or ""
        candidates = [c for c in fused if c.get("text")]
        return {"candidates": candidates, "fts_hits": len(f_hits),
                "vector_hits": len(v_hits)}
