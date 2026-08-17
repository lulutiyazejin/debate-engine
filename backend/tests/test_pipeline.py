"""入库流水线 E2E 测试（离线路由器）：导入 → 断点恢复 → 级联删除。"""
from __future__ import annotations

import json

import config
from ingestion.indexer import Indexer


def _make_doc(tmp_path, name="hayek.md", stance_word="市场"):
    p = tmp_path / name
    p.write_text(
        "---\ntitle: 通往奴役之路\nauthor: 哈耶克\nyear: 1944\n---\n"
        f"# 第一章 被离弃的道路\n{stance_word}经济依靠价格信号自发配置资源，"
        "中央计划无法获得分散在无数个体中的知识。\n\n"
        "# 第二章 伟大的乌托邦\n计划经济必然走向对个人自由的压制，"
        "因为经济控制不仅是对物的控制，也是对人的控制。\n",
        encoding="utf-8")
    return p


def _indexer(db, vec, offline_router):
    return Indexer(sqlite=db, vectors=vec, router=offline_router)


class TestPipeline:
    def test_full_import(self, kb, db, vec, offline_router):
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        result = idx.import_document(str(src), stance="liberal")

        assert result["chunks"] >= 1
        doc = db.get_document(result["doc_id"])
        assert doc["stance"] == "liberal"
        assert doc["author"] == "哈耶克"
        # meta.json 生成且坐标齐全
        meta = json.loads((config.STANCES_PATH / "liberal" /
                           f"{result['doc_id']}.meta.json")
                          .read_text(encoding="utf-8"))
        assert meta["title"] == "通往奴役之路"
        # 22 轴坐标 + low_confidence_axes 标记（项目10）
        axes = [k for k in meta["coordinates"] if k != "low_confidence_axes"]
        assert len(axes) == 22
        # 向量已入库、FTS 可检索
        assert vec.count() == result["chunks"]
        assert db.fts_search("价格信号")
        # INDEX.md 更新
        assert result["doc_id"] in config.INDEX_MD_PATH.read_text(
            encoding="utf-8")
        # 源文件归档
        assert list(config.SOURCE_FILES_PATH.glob(f"{result['doc_id']}.md"))

    def test_resume_skips_done_stages(self, kb, db, vec, offline_router, monkeypatch):
        """断点恢复：第一次预览完成摘要后，重跑不再调用摘要 LLM。"""
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        idx.preview(str(src))  # 第一次：写入 summarized=done + 缓存

        calls = {"n": 0}
        import ingestion.indexer as indexer_mod

        real = indexer_mod.summarize_chapter_with_args

        def counting(*a, **kw):
            calls["n"] += 1
            return real(*a, **kw)

        monkeypatch.setattr(indexer_mod, "summarize_chapter_with_args", counting)
        idx.preview(str(src))  # 第二次：全部章节应跳过
        assert calls["n"] == 0

    def test_cascade_delete(self, kb, db, vec, offline_router):
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        result = idx.import_document(str(src), stance="liberal")
        doc_id = result["doc_id"]

        counts = idx.delete_document(doc_id)
        assert counts["documents"] == 1
        assert counts["vectors"] == result["chunks"]
        assert db.get_document(doc_id) is None
        assert vec.count() == 0
        assert not list(config.STANCES_PATH.glob(f"*/{doc_id}.meta.json"))

    def test_idempotent_doc_id(self, kb, db, vec, offline_router):
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        pv1 = idx.preview(str(src))
        pv2 = idx.preview(str(src))
        assert pv1.doc_id == pv2.doc_id


class TestDedup:
    """项目2：导入查重与版本更新。"""

    def test_exact_duplicate_skipped(self, kb, db, vec, offline_router):
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        r1 = idx.import_document(str(src), stance="liberal")
        r2 = idx.import_document(str(src), stance="liberal")
        assert r2.get("skipped") == "exact_duplicate"
        assert r2["existing"] == r1["doc_id"]

    def test_new_version_detect_and_replace(self, kb, db, vec, offline_router):
        src = _make_doc(kb)
        idx = _indexer(db, vec, offline_router)
        r1 = idx.import_document(str(src), stance="liberal")
        # 同路径改内容 = 新版本
        src.write_text(src.read_text(encoding="utf-8") +
                       "\n新增一段：市场也需要法治框架。\n", encoding="utf-8")
        r2 = idx.import_document(str(src), stance="liberal",
                                 on_duplicate="skip")
        assert r2.get("skipped") == "new_version_detected"
        r3 = idx.import_document(str(src), stance="liberal",
                                 on_duplicate="replace")
        assert r3["doc_id"] != r1["doc_id"]
        assert db.get_document(r1["doc_id"]) is None    # 旧版已软删
        assert db.get_document(r3["doc_id"]) is not None

