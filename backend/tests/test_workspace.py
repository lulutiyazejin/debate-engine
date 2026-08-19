"""0.1.2 工作台测试：素材篮/回应历史（项目18/19）+ 逻辑链（项目14）+ 意图（项目16）。全离线。"""
from __future__ import annotations

import pytest

from engine.alignment import AlignmentEngine
from engine.rebuttal_engine import INTENTS, build_prompt
from tests.test_alignment import KeywordEmbedder, StubRouter, _args


class TestBasket:
    def test_add_list_remove(self, db):
        r = db.basket_add("chunk", "c1", "市场经济的证据段落", "哈耶克")
        assert r["id"] and not r["duplicated"]
        # 唯一约束：同条目重复加不报错、标记 duplicated
        r2 = db.basket_add("chunk", "c1", "市场经济的证据段落", "哈耶克")
        assert r2["duplicated"]
        items = db.basket_list()
        assert len(items) == 1 and items[0]["used"] == 0
        db.basket_mark_used([items[0]["id"]])
        assert db.basket_list()[0]["used"] == 1
        assert db.basket_remove(items[0]["id"]) == 1
        assert db.basket_list() == []

    def test_no_storage_cap(self, db):
        # 0.1.4 批 4：存储无上限（BASKET_CAP 只是注入预算，不再限存储）
        for i in range(db.BASKET_CAP + 5):
            db.basket_add("chunk", f"c{i}", f"证据{i}")
        assert len(db.basket_list()) == db.BASKET_CAP + 5

    def test_groups(self, db):
        # 公共素材组常在且置顶；素材缺省归公共组
        groups = db.group_list()
        assert groups[0]["pinned"] == 1 and groups[0]["name"] == db.PUBLIC_GROUP
        pub = groups[0]["id"]
        db.basket_add("chunk", "g1", "默认入公共组")
        assert db.basket_list()[0]["group_id"] == pub
        # 建组 → 指定组入料 → 删组材料并入公共组（无孤儿）
        g = db.group_add("经济学")
        db.basket_add("chunk", "g2", "组内素材", group_id=g["id"])
        with pytest.raises(ValueError):
            db.group_add("经济学")          # 重名拒绝
        with pytest.raises(ValueError):
            db.group_delete(pub)            # 公共组不可删
        moved = db.group_delete(g["id"])
        assert moved["moved"] == 1
        rows = db.basket_list()
        assert all(r["group_id"] == pub for r in rows)


class TestResponses:
    def test_add_star_delete(self, db):
        rid = db.response_add("rebut", "对方论点", "反驳正文",
                              provider="stub", stance="liberal")
        rid2 = db.response_add("evaluate", "另一论点", "评价正文")
        assert db.response_star(rid, True) == 1
        items = db.response_list()
        assert len(items) == 2
        assert items[0]["id"] == rid, "收藏项应置顶"
        assert db.response_delete(rid2) == 1
        assert len(db.response_list()) == 1


class TestLogicChain:
    def test_chain_after_relations(self, db):
        _args(db)
        eng = AlignmentEngine(db, router=StubRouter(),
                              embedder=KeywordEmbedder())
        eng.build_relations()
        r = eng.logic_chain("市场价格信号")
        assert r["nodes"], "写回关系边后逻辑链应有节点"
        assert r["links"], "链内应保留关系边"
        ids = {n["id"] for n in r["nodes"]}
        assert all(l["source"] in ids and l["target"] in ids
                   for l in r["links"])

    def test_chain_without_edges_hints(self, db, offline_router):
        _args(db)
        eng = AlignmentEngine(db, router=offline_router,
                              embedder=KeywordEmbedder())
        r = eng.logic_chain("市场价格信号")
        # 离线规则会写 oppose 边吗？未 build 前无边 → 必须给引导语
        assert r["nodes"] == [] and "关系边" in r["hint"]


class TestIntents:
    def test_prompt_branches(self):
        parsed = {"core_claim": "X", "attack_surface": ["a"]}
        for intent in INTENTS:
            msgs = build_prompt("论点", parsed, [], "liberal",
                                "argument", "rebuttal", intent=intent)
            assert msgs[0]["role"] == "system"
            verb = INTENTS[intent]["verb"]
            assert f"请生成{verb}" in msgs[1]["content"]
        # 批判/评价的方法论指令要落进 system prompt
        crit = build_prompt("论点", parsed, [], "liberal", "argument",
                            "rebuttal", intent="critique")
        assert "结构" in crit[0]["content"]

    def test_material_marked_must_use(self):
        parsed = {"core_claim": "X", "attack_surface": ["a"]}
        cites = [{"id": "C1", "author": "素材篮", "title": "用户指定素材",
                  "year": "", "pages": "", "text": "必用证据",
                  "must_use": True}]
        msgs = build_prompt("论点", parsed, cites, "liberal",
                            "argument", "rebuttal")
        assert "必须引用" in msgs[1]["content"]
