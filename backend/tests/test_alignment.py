"""对齐引擎测试（项目15/16/17）：配对/分歧/对比/关系写回/溯源，全离线。"""
from __future__ import annotations

import numpy as np
import pytest

from engine.alignment import AlignmentEngine, _split_units, graph_data
from tests.test_storage import _seed


class KeywordEmbedder:
    """确定性测试嵌入器：按关键词命中生成向量（同话题→高余弦）。"""
    KEYS = ["市场", "价格", "计划", "资本", "利润", "自由", "平等", "国家"]

    def embed(self, text: str) -> np.ndarray:
        v = np.array([float(text.count(k)) for k in self.KEYS] + [0.1],
                     dtype=np.float32)
        return v / (np.linalg.norm(v) + 1e-9)


class StubRouter:
    """关系判定桩：含否定词差异 → attack，否则 support。"""

    def run(self, task, messages, **kw):
        content = messages[-1]["content"]
        if "无法" in content or "失败" in content:
            return ('{"relation": "attack", "note": "结论对立"}', "stub")
        return ('{"relation": "support", "note": "互为支撑"}', "stub")


def _args(db):
    _seed(db, "doc_a", "liberal", "市场经济依靠价格信号配置资源")
    _seed(db, "doc_b", "liberal", "计划体制无法处理价格信息")
    db.insert_arg_unit({"arg_id": "a1", "chunk_id": "doc_a_c0000",
                        "doc_id": "doc_a", "thinker": "哈耶克",
                        "claim": "市场价格信号能配置资源"})
    db.insert_arg_unit({"arg_id": "b1", "chunk_id": "doc_b_c0000",
                        "doc_id": "doc_b", "thinker": "兰格",
                        "claim": "市场价格信号无法配置资源"})
    db.insert_arg_unit({"arg_id": "b2", "chunk_id": "doc_b_c0000",
                        "doc_id": "doc_b", "claim": "国家与平等问题另论"})


@pytest.fixture
def align(db, offline_router):
    _args(db)
    return AlignmentEngine(db, router=offline_router,
                           embedder=KeywordEmbedder())


class TestAlignment:
    def test_pair_units_same_topic(self, align, db):
        units = db.list_arg_units()
        pairs = align.pair_units(units, units, skip_same_doc=True)
        assert pairs, "同话题单元应配对成功"
        top = pairs[0]
        assert {top["a"]["arg_id"], top["b"]["arg_id"]} == {"a1", "b1"}

    def test_offline_rule_fallback(self, align):
        """离线路由：不下结论，只标 similar + 否定词提示。"""
        j = align.classify_pair({"claim": "市场能配置资源", "doc_id": "x",
                                 "arg_id": "x1"},
                                {"claim": "市场无法配置资源", "doc_id": "y",
                                 "arg_id": "y1"})
        assert j["relation"] == "similar"
        assert j["judged_by"] == "rule"
        assert "对立" in j["note"]

    def test_divergence_map(self, align):
        r = align.divergence_map("liberal")
        assert r["unit_count"] == 3
        assert r["divergences"], "同立场对立论点应出现在分歧地图"

    def test_build_relations_with_llm(self, db):
        _args(db)
        eng = AlignmentEngine(db, router=StubRouter(),
                              embedder=KeywordEmbedder())
        r = eng.build_relations()
        assert r["relations_written"] >= 1
        g = graph_data(db)
        assert len(g["nodes"]) == 3
        assert g["links"], "写回的关系边应出现在图谱数据中"
        assert g["links"][0]["relation"] in ("support", "attack", "refine")

    def test_unit_edit_and_delete_clears_dangling(self, db):
        _args(db)
        db.update_arg_relation("a1", "attack", "b1")
        assert db.update_arg_unit("a1", {"thinker": "米塞斯"}) == 1
        # 删 b1 后指向它的边必须清除（无悬挂引用）
        assert db.delete_arg_unit("b1") == 1
        a1 = [u for u in db.list_arg_units() if u["arg_id"] == "a1"][0]
        assert a1["relation"] is None and a1["target_unit_id"] is None

    def test_trace_sorted_by_year(self, align, db):
        db.conn.execute("UPDATE documents SET year=1944 WHERE doc_id='doc_a'")
        db.conn.execute("UPDATE documents SET year=1936 WHERE doc_id='doc_b'")
        db.conn.commit()
        r = align.trace("市场价格信号配置资源")
        years = [c["year"] for c in r["chain"] if c["year"]]
        assert years == sorted(years), "溯源链按年代升序"
        assert all(c["evidence_level"] == "有据" for c in r["chain"])
        assert r["speculation"] == ""   # 离线：不产生模型推测

    def test_split_units(self):
        us = _split_units("市场经济好。计划经济不行。短。", "t")
        assert all(len(u["claim"]) >= 3 for u in us)
        assert us[0]["doc_id"] == "t"
