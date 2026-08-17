"""LanceDB 向量存储：int8 兼容、版本绑定、级联删除。

无 lancedb 依赖时降级为内存 + JSON 持久化的简易向量库（NumpyVectorStore），
保证管线在轻量环境可测试。接口一致，可无缝切换。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

try:
    import lancedb
    import pyarrow as pa
    _HAS_LANCE = True
except ImportError:
    _HAS_LANCE = False


class VectorStoreBase:
    def add(self, chunk_id: str, doc_id: str, vector: np.ndarray,
            embedding_model: str) -> None: ...
    def search(self, vector: np.ndarray, top_k: int = 20,
               doc_ids: list[str] | None = None) -> list[dict]: ...
    def delete_doc(self, doc_id: str) -> int: ...
    def count(self) -> int: ...


class LanceVectorStore(VectorStoreBase):
    """生产实现：LanceDB 本地目录（未来可指 S3）。"""
    TABLE = "chunks"

    def __init__(self, path: Path | str | None = None):
        self.db = lancedb.connect(str(path or config.LANCE_PATH))
        try:
            self._table = self.db.open_table(self.TABLE)
        except Exception:  # 表不存在（首次使用）
            self._table = None

    def _ensure_table(self, dim: int):
        if self._table is None:
            schema = pa.schema([
                pa.field("chunk_id", pa.string()),
                pa.field("doc_id", pa.string()),
                pa.field("embedding_model", pa.string()),
                pa.field("vector", pa.list_(pa.float32(), dim)),
            ])
            self._table = self.db.create_table(self.TABLE, schema=schema)
        return self._table

    def add(self, chunk_id, doc_id, vector, embedding_model):
        t = self._ensure_table(len(vector))
        t.add([{"chunk_id": chunk_id, "doc_id": doc_id,
                "embedding_model": embedding_model,
                "vector": np.asarray(vector, dtype=np.float32)}])

    def search(self, vector, top_k=20, doc_ids=None):
        if self._table is None:
            return []
        q = self._table.search(np.asarray(vector, dtype=np.float32)).limit(top_k * 3)
        rows = q.to_list()
        out = []
        for r in rows:
            if r["embedding_model"] != config.EMBEDDING_MODEL_NAME:
                continue  # 版本不一致的向量跳过
            if doc_ids and r["doc_id"] not in doc_ids:
                continue
            out.append({"chunk_id": r["chunk_id"], "doc_id": r["doc_id"],
                        "score": 1.0 / (1.0 + float(r.get("_distance", 0.0)))})
            if len(out) >= top_k:
                break
        return out

    def delete_doc(self, doc_id):
        if self._table is None:
            return 0
        before = self._table.count_rows()
        self._table.delete(f'doc_id = "{doc_id}"')
        return before - self._table.count_rows()

    def count(self):
        return self._table.count_rows() if self._table is not None else 0


class NumpyVectorStore(VectorStoreBase):
    """降级实现：内存 + npz/json 持久化。接口与 LanceVectorStore 一致。"""

    def __init__(self, path: Path | str | None = None):
        self.dir = Path(path or config.LANCE_PATH)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.meta_path = self.dir / "np_meta.json"
        self.vec_path = self.dir / "np_vectors.npy"
        self.meta: list[dict] = []
        self.vectors: np.ndarray | None = None
        self._load()

    def _load(self):
        if self.meta_path.exists() and self.vec_path.exists():
            self.meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            self.vectors = np.load(self.vec_path)

    def _save(self):
        self.meta_path.write_text(
            json.dumps(self.meta, ensure_ascii=False), encoding="utf-8")
        if self.vectors is not None:
            np.save(self.vec_path, self.vectors)

    def add(self, chunk_id, doc_id, vector, embedding_model):
        v = np.asarray(vector, dtype=np.float32).reshape(1, -1)
        self.vectors = v if self.vectors is None else np.vstack([self.vectors, v])
        self.meta.append({"chunk_id": chunk_id, "doc_id": doc_id,
                          "embedding_model": embedding_model})
        self._save()

    def search(self, vector, top_k=20, doc_ids=None):
        if self.vectors is None or len(self.meta) == 0:
            return []
        q = np.asarray(vector, dtype=np.float32)
        norms = np.linalg.norm(self.vectors, axis=1) * (np.linalg.norm(q) + 1e-9)
        sims = self.vectors @ q / (norms + 1e-9)
        order = np.argsort(-sims)
        out = []
        for i in order:
            m = self.meta[int(i)]
            if m["embedding_model"] != config.EMBEDDING_MODEL_NAME:
                continue
            if doc_ids and m["doc_id"] not in doc_ids:
                continue
            out.append({"chunk_id": m["chunk_id"], "doc_id": m["doc_id"],
                        "score": float(sims[int(i)])})
            if len(out) >= top_k:
                break
        return out

    def delete_doc(self, doc_id):
        if self.vectors is None:
            return 0
        keep = [i for i, m in enumerate(self.meta) if m["doc_id"] != doc_id]
        removed = len(self.meta) - len(keep)
        self.meta = [self.meta[i] for i in keep]
        self.vectors = self.vectors[keep] if keep else None
        if self.vectors is None and self.vec_path.exists():
            self.vec_path.unlink()
        self._save()
        return removed

    def count(self):
        return len(self.meta)


def get_vector_store(path: Path | str | None = None) -> VectorStoreBase:
    """工厂：优先 LanceDB，缺依赖时降级 NumpyVectorStore。"""
    if _HAS_LANCE:
        try:
            return LanceVectorStore(path)
        except Exception:
            pass
    return NumpyVectorStore(path)
