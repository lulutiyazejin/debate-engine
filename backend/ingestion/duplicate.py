"""查重（0.1.5 B3：从 indexer 拆出）。

内容哈希查重（同内容同 doc_id，换目录不重复入库）+ 语义近似查重
（全书总结向量余弦 > 0.92 判近似，预览阶段提示用户）。
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ingestion.parsers import ParsedDocument
from models.embedder import get_embedder


def content_hash(source: str, parsed: ParsedDocument) -> str:
    """内容哈希：本地文件哈希字节；URL/无文件哈希解析后正文。

    doc_id 由此而来：同内容得同 ID（换目录不重复入库）；
    内容改动得新 ID（配合 source_path 字段识别“新版本”）。
    """
    p = Path(source)
    if p.exists() and p.is_file():
        return hashlib.sha256(p.read_bytes()).hexdigest()
    return hashlib.sha256(parsed.full_text.encode("utf-8")).hexdigest()


def doc_id_from_hash(h: str) -> str:
    return f"doc_{h[:12]}"


def semantic_duplicate(db, doc_id: str, doc_summary: str) -> dict | None:
    """语义近似查重：与库内各文档全书总结做余弦相似度，>0.92 报近似。"""
    docs = [d for d in db.list_documents()
            if d.get("summary") and d["doc_id"] != doc_id]
    if not docs:
        return None
    emb = get_embedder()
    vecs = emb.embed_batch([doc_summary] + [d["summary"] for d in docs])
    q = np.asarray(vecs[0], dtype=np.float32)
    for d, v in zip(docs, vecs[1:]):
        v = np.asarray(v, dtype=np.float32)
        sim = float(q @ v / (np.linalg.norm(q) * np.linalg.norm(v) + 1e-9))
        if sim > 0.92:
            return {"type": "semantic", "existing_doc_id": d["doc_id"],
                    "existing_title": d.get("title"),
                    "similarity": round(sim, 3)}
    return None
