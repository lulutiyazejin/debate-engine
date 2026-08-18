"""知识库打包器测试（项目14）：打包/隐私红线/合并导入/嵌入漂移重建。"""
from __future__ import annotations

import json
import zipfile

import numpy as np
import pytest

import config
from storage.lance_store import NumpyVectorStore
from storage.packer import KnowledgePacker
from storage.sqlite_store import SqliteStore
from tests.test_storage import _seed


@pytest.fixture
def packed(db, tmp_path):
    """两文档 + 向量的库 → 打包文件。"""
    _seed(db, "doc_a", "liberal", "市场经济依靠价格信号配置资源")
    _seed(db, "doc_b", "marxist", "资本积累导致利润率趋向下降")
    db.conn.execute("UPDATE documents SET content_hash='hash_a' WHERE doc_id='doc_a'")
    db.conn.execute("UPDATE documents SET content_hash='hash_b' WHERE doc_id='doc_b'")
    db.conn.commit()
    vec = NumpyVectorStore(tmp_path / "vec_src")
    rng = np.random.default_rng(7)
    vec.add("doc_a_c0000", "doc_a", rng.random(8).astype(np.float32),
            config.EMBEDDING_MODEL_NAME)
    vec.add("doc_b_c0000", "doc_b", rng.random(8).astype(np.float32),
            config.EMBEDDING_MODEL_NAME)
    out = tmp_path / "kb.debkb"
    manifest = KnowledgePacker(db, vec).pack(out)
    return db, vec, out, manifest


class TestPacker:
    def test_pack_manifest(self, packed):
        _db, _vec, out, manifest = packed
        assert manifest["documents"] == 2
        assert manifest["chunks"] == 2
        assert manifest["vectors"] == 2
        assert KnowledgePacker.verify(out)["format"] == "debkb/1"

    def test_privacy_red_line(self, packed, tmp_path):
        """打包产物零隐私文件；带 logs/.env 的坏包被拒。"""
        _db, _vec, out, _m = packed
        with zipfile.ZipFile(out) as z:
            for n in z.namelist():
                assert "logs" not in n.lower()
                assert ".env" not in n.lower()
        bad = tmp_path / "bad.debkb"
        with zipfile.ZipFile(bad, "w") as z:
            z.writestr("manifest.json", "{}")
            z.writestr("data.json", "{}")
            z.writestr("logs/app.log", "secret")
        with pytest.raises(ValueError, match="隐私"):
            KnowledgePacker.verify(bad)

    def test_import_merge_and_dedup(self, packed, tmp_path):
        """空库合并全入；再次导入按内容哈希跳过。"""
        _db, _vec, out, _m = packed
        db2 = SqliteStore(tmp_path / "kb2.db")
        vec2 = NumpyVectorStore(tmp_path / "vec_dst")
        p2 = KnowledgePacker(db2, vec2)
        r1 = p2.import_package(out)
        assert r1["imported"] == 2 and r1["skipped"] == 0
        assert db2.stats()["documents"] == 2
        assert vec2.count() == 2                      # 模型一致：向量直入
        assert r1["reembedded"] == 0
        assert db2.fts_search("价格信号")             # FTS 同步重建
        r2 = p2.import_package(out)                   # 幂等：全部跳过
        assert r2["imported"] == 0 and r2["skipped"] == 2
        db2.close()

    def test_embedding_drift_reembed(self, packed, tmp_path, offline_router):
        """嵌入模型版本不匹配 → 用包内文本重嵌入。"""
        _db, _vec, out, _m = packed
        drift = tmp_path / "drift.debkb"
        with zipfile.ZipFile(out) as zin, zipfile.ZipFile(drift, "w") as zout:
            for n in zin.namelist():
                data = zin.read(n)
                if n == "manifest.json":
                    m = json.loads(data)
                    m["embedding_model"] = "old-model-v0"
                    data = json.dumps(m).encode("utf-8")
                zout.writestr(n, data)
        db3 = SqliteStore(tmp_path / "kb3.db")
        vec3 = NumpyVectorStore(tmp_path / "vec3")
        r = KnowledgePacker(db3, vec3).import_package(drift)
        assert r["imported"] == 2
        assert r["reembedded"] == 2
        assert vec3.count() == 2
        db3.close()
