"""存储层测试：SQLite 建表/写入/FTS5/级联删除/断点 + 向量库。"""
from __future__ import annotations

import numpy as np
import pytest

import config
from storage.lance_store import NumpyVectorStore


def _seed(db, doc_id="doc_a", stance="liberal", text="市场经济依靠价格信号配置资源"):
    db.upsert_document({"doc_id": doc_id, "title": "测试文档", "author": "张三",
                        "year": 2020, "stance": stance, "source_type": "txt",
                        "import_date": "2026-08-17"})
    db.upsert_chapter({"chapter_id": f"{doc_id}_ch000", "doc_id": doc_id,
                       "chapter_num": 1, "title": "第一章", "token_count": 100})
    db.insert_chunk({"chunk_id": f"{doc_id}_c0000",
                     "chapter_id": f"{doc_id}_ch000", "doc_id": doc_id,
                     "text": text, "embedding_model": "bge-m3-v1.5",
                     "embedding_dim": 1024})


class TestSqlite:
    def test_document_roundtrip(self, db):
        _seed(db)
        doc = db.get_document("doc_a")
        assert doc["title"] == "测试文档"
        assert doc["stance"] == "liberal"
        assert db.stats()["documents"] == 1

    def test_fts_chinese_search(self, db):
        _seed(db)
        hits = db.fts_search("价格信号")
        assert hits and hits[0]["chunk_id"] == "doc_a_c0000"

    def test_fts_doc_filter(self, db):
        _seed(db, "doc_a")
        _seed(db, "doc_b", text="计划经济依靠中央指令配置资源")
        hits = db.fts_search("配置资源", doc_ids=["doc_b"])
        assert hits and all(h["doc_id"] == "doc_b" for h in hits)

    def test_cascade_delete(self, db):
        """0.1.1 新语义：默认软删（可恢复），硬删物理级联。"""
        _seed(db)
        db.insert_arg_unit({"arg_id": "a1", "chunk_id": "doc_a_c0000",
                            "doc_id": "doc_a", "claim": "x"})
        db.set_progress("doc_a", "doc_a_ch000", "summarized", "done")
        # 软删：标记 + FTS 清除，检索/列表立刻干净，元数据保留
        counts = db.delete_document("doc_a")
        assert counts["documents"] == 1
        assert counts["fts_index"] == 1
        assert db.get_document("doc_a") is None
        assert db.get_document("doc_a", include_deleted=True) is not None
        assert db.fts_search("价格信号") == []
        assert db.stats()["documents"] == 0
        assert db.stats()["chunks"] == 0  # 存活统计不含软删文档
        # 硬删：物理级联清除
        counts = db.delete_document("doc_a", hard=True)
        assert counts["chunks"] == 1
        assert db.get_document("doc_a", include_deleted=True) is None

    def test_content_hash_lookup(self, db):
        """服务器级 schema 新列：哈希查重与路径查新版本。"""
        _seed(db)
        db.upsert_document({"doc_id": "doc_a", "title": "测试文档",
                            "stance": "liberal", "content_hash": "h" * 64,
                            "source_path": "C:/docs/a.pdf"})
        assert db.find_by_hash("h" * 64)["doc_id"] == "doc_a"
        assert db.find_by_source_path("C:/docs/a.pdf")["doc_id"] == "doc_a"
        assert db.find_by_hash("x" * 64) is None

    def test_progress_resume(self, db):
        assert db.get_progress("d", "c", "summarized") is None
        db.set_progress("d", "c", "summarized", "done")
        assert db.get_progress("d", "c", "summarized") == "done"
        db.set_progress("d", "c", "summarized", "failed")
        assert db.get_progress("d", "c", "summarized") == "failed"


class TestNumpyVectorStore:
    def test_add_search_cosine(self, vec):
        a = np.zeros(8, dtype=np.float32); a[0] = 1
        b = np.zeros(8, dtype=np.float32); b[1] = 1
        vec.add("c1", "d1", a, config.EMBEDDING_MODEL_NAME)
        vec.add("c2", "d2", b, config.EMBEDDING_MODEL_NAME)
        hits = vec.search(a, top_k=1)
        assert hits[0]["chunk_id"] == "c1"

    def test_version_mismatch_skipped(self, vec):
        v = np.ones(8, dtype=np.float32)
        vec.add("c1", "d1", v, "old-model-v0")
        assert vec.search(v, top_k=5) == []

    def test_delete_doc(self, vec):
        v = np.ones(8, dtype=np.float32)
        vec.add("c1", "d1", v, config.EMBEDDING_MODEL_NAME)
        vec.add("c2", "d1", v, config.EMBEDDING_MODEL_NAME)
        assert vec.delete_doc("d1") == 2
        assert vec.count() == 0


class TestLanceDB:
    def test_lance_roundtrip(self, kb):
        lancedb = pytest.importorskip("lancedb")  # noqa: F841
        from storage.lance_store import LanceVectorStore
        store = LanceVectorStore(kb / "lance_real")
        v = np.random.rand(16).astype(np.float32)
        store.add("c1", "d1", v, config.EMBEDDING_MODEL_NAME)
        store.add("c2", "d1", v * 0.5, config.EMBEDDING_MODEL_NAME)
        hits = store.search(v, top_k=2)
        assert hits and hits[0]["chunk_id"] == "c1"
        assert store.delete_doc("d1") == 2
