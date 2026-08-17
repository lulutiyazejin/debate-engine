"""检索链 + 论点解析 + 反驳引擎测试（离线确定性）。"""
from __future__ import annotations

from engine.argument_parser import parse_argument
from engine.rebuttal_engine import (RebuttalEngine, build_citations,
                                    validate_citations)
from engine.reranker import RetrievalChain, rerank
from engine.retriever import rrf_fuse
from engine.stance_router import StanceRouter
from ingestion.indexer import Indexer
from models.llm_client import LLMError, OfflineProvider, Provider
from models.model_router import ModelRouter


def _import_two_stances(kb, db, vec, offline_router):
    """入库一篇 liberal + 一篇 marxist，返回 (liberal_id, marxist_id)。"""
    idx = Indexer(sqlite=db, vectors=vec, router=offline_router)
    lib = kb / "hayek.md"
    lib.write_text("---\ntitle: 通往奴役之路\nauthor: 哈耶克\n---\n"
                   "# 自发秩序\n市场经济的效率来自价格信号的自发协调，"
                   "政府计划无法替代分散知识。\n", encoding="utf-8")
    mar = kb / "capital.md"
    mar.write_text("---\ntitle: 资本论\nauthor: 马克思\n---\n"
                   "# 剩余价值\n资本主义生产的效率建立在对剩余价值的剥削之上，"
                   "计划才能实现真正的公平。\n", encoding="utf-8")
    r1 = idx.import_document(str(lib), stance="liberal")
    r2 = idx.import_document(str(mar), stance="marxist")
    return r1["doc_id"], r2["doc_id"]


class TestArgumentParser:
    def test_negation_preserved(self, offline_router):
        arg = "市场经济并不能解决贫富分化问题"
        parsed = parse_argument(arg, router=offline_router)
        assert "不" in parsed["core_claim"]  # 否定词不被稻草人化
        assert parsed["implicit_target"]

    def test_condition_detected(self, offline_router):
        arg = "如果没有政府管制，市场就会失灵"
        parsed = parse_argument(arg, router=offline_router)
        assert parsed["core_claim"].startswith("如果") or parsed["conditions"]


class TestStanceRouting:
    def test_stance_pollution(self, kb, db, vec, offline_router):
        """立场污染测试：liberal 检索不返回 marxist 文档。"""
        lib_id, mar_id = _import_two_stances(kb, db, vec, offline_router)
        chain = RetrievalChain(sqlite=db, vectors=vec, router=offline_router)
        r = chain.run("市场效率", "liberal")
        doc_ids = {c["doc_id"] for c in r["chunks"]}
        assert mar_id not in doc_ids          # 排除 marxist
        assert mar_id in r["route"]["excluded"]

    def test_router_weights(self, kb, db, vec, offline_router):
        lib_id, mar_id = _import_two_stances(kb, db, vec, offline_router)
        route = StanceRouter(sqlite=db).route("liberal")
        assert route["weights"][lib_id] > 1.0  # 本立场加权
        assert mar_id not in route["weights"]


class TestFusion:
    def test_rrf(self):
        v = [{"chunk_id": "a", "doc_id": "d"}, {"chunk_id": "b", "doc_id": "d"}]
        f = [{"chunk_id": "b", "doc_id": "d"}, {"chunk_id": "c", "doc_id": "d"}]
        fused = rrf_fuse(v, f, k=60)
        assert fused[0]["chunk_id"] == "b"  # 双路命中排第一

    def test_rerank_weight(self):
        cands = [{"chunk_id": "a", "doc_id": "d1", "score": 1.0, "text": "x"},
                 {"chunk_id": "b", "doc_id": "d2", "score": 1.0, "text": "y"}]
        out = rerank(cands, {"d1": 0.3, "d2": 1.5})
        assert out[0]["chunk_id"] == "b"


class _HallucinatingProvider(Provider):
    """第一次输出无效引用 [C9]，重试后输出有效 [C1]。"""

    def __init__(self):
        super().__init__("groq", "http://fake", "key", "fake")
        self.calls = 0

    def available(self):
        return True

    def chat(self, messages, **kw):
        self.calls += 1
        if any("不存在的引用" in m.get("content", "") for m in messages):
            return "反驳观点见 [C1]。"
        return "根据 [C9] 的研究，你的观点错误。"


class TestRebuttal:
    def test_validate_citations(self):
        cites = [{"id": "C1"}, {"id": "C2"}]
        assert validate_citations("见 [C1] 和 [C2]", cites) == []
        assert validate_citations("见 [C3]", cites) == ["C3"]

    def test_offline_generate_formats_styles(self, kb, db, vec, offline_router):
        _import_two_stances(kb, db, vec, offline_router)
        engine = RebuttalEngine(
            chain=RetrievalChain(sqlite=db, vectors=vec, router=offline_router),
            router=offline_router, sqlite=db)
        for fmt in ("quick", "argument", "report"):
            for style in ("rebuttal", "critique"):
                r = engine.generate("计划经济优于市场经济", "liberal",
                                    fmt, style)
                assert r["rebuttal"]
                assert r["provider"] == "offline"
                # 防幻觉验收：输出引用必须在注入 context 中
                assert validate_citations(
                    r["rebuttal"],
                    [{"id": c["id"]} for c in r["citations"]]) == [] or \
                    not r["citations"]

    def test_hallucination_retry(self, kb, db, vec, offline_router):
        _import_two_stances(kb, db, vec, offline_router)
        bad = _HallucinatingProvider()
        router = ModelRouter(providers={"groq": bad,
                                        "offline": OfflineProvider()})
        engine = RebuttalEngine(
            chain=RetrievalChain(sqlite=db, vectors=vec, router=offline_router),
            router=router, sqlite=db)
        r = engine.generate("市场经济已经失败", "liberal", "quick", "rebuttal")
        assert "[C9]" not in r["rebuttal"]  # 无效引用被重试修正
        assert bad.calls == 2

    def test_citation_metadata(self, kb, db, vec, offline_router):
        _import_two_stances(kb, db, vec, offline_router)
        chain = RetrievalChain(sqlite=db, vectors=vec, router=offline_router)
        r = chain.run("市场效率", "liberal")
        cites = build_citations(r["chunks"], db)
        assert cites and cites[0]["author"] == "哈耶克"
        assert cites[0]["id"] == "C1"


class TestModelRouterFallback:
    def test_rate_limit_falls_through(self):
        class Limited(Provider):
            def __init__(self, name):
                super().__init__(name, "http://x", "k", "m")

            def available(self):
                return True

            def chat(self, messages, **kw):
                raise LLMError("rate_limit", "429")

        router = ModelRouter(providers={"groq": Limited("groq"),
                                        "gemini": Limited("gemini"),
                                        "offline": OfflineProvider()})
        out, provider = router.run("rebuttal",
                                   [{"role": "user", "content": "测试"}])
        assert provider == "offline"  # 全部限速 → 离线兜底
        assert out
