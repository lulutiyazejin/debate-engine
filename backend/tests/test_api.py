"""FastAPI 接口测试：health / stances / import→confirm / rebuttal(同步)。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(kb, monkeypatch):
    """每个测试用干净的单例 + 隔离路径 + 离线路由器。"""
    import api.deps as deps
    monkeypatch.setattr(deps, "_db", None)
    monkeypatch.setattr(deps, "_engine", None)
    monkeypatch.setattr(deps, "_indexer", None)

    # 强制离线（不真实调外部 API）
    from models.llm_client import OfflineProvider
    from models.model_router import ModelRouter
    import models.model_router as mr
    monkeypatch.setattr(mr, "_router",
                        ModelRouter(providers={"offline": OfflineProvider()}))

    from main import app
    with TestClient(app) as c:
        yield c


def _write_doc(kb):
    p = kb / "doc.md"
    p.write_text("---\ntitle: 测试文献\nauthor: 王五\n---\n"
                 "# 论市场\n市场经济依靠价格信号自发配置资源。\n",
                 encoding="utf-8")
    return p


class TestApi:
    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["skills"]["stances"] == 17

    def test_stances(self, client):
        r = client.get("/api/stances")
        assert r.status_code == 200
        names = {s["name"] for s in r.json()["stances"]}
        assert {"liberal", "marxist", "conservative",
                "social_democracy", "empirical"} <= names

    def test_import_confirm_and_rebuttal(self, client, kb):
        src = _write_doc(kb)
        r = client.post("/api/import", json={"source": str(src)})
        assert r.status_code == 200
        doc_id = r.json()["doc_id"]
        assert r.json()["classification"]["stance"]

        r = client.post("/api/import/confirm",
                        json={"doc_id": doc_id, "stance": "liberal"})
        assert r.status_code == 200
        assert r.json()["chunks"] >= 1

        r = client.get("/api/knowledge/docs")
        assert r.json()["stats"]["documents"] == 1

        r = client.post("/api/rebuttal",
                        json={"argument": "计划经济优于市场", "stance": "liberal",
                              "format": "quick", "style": "rebuttal",
                              "stream": False})
        assert r.status_code == 200
        assert r.json()["rebuttal"]

    def test_import_missing_file(self, client):
        r = client.post("/api/import", json={"source": "Z:/no/such.pdf"})
        assert r.status_code == 404

    def test_confirm_unknown_doc(self, client):
        r = client.post("/api/import/confirm",
                        json={"doc_id": "doc_nothing", "stance": "liberal"})
        assert r.status_code == 404

    def test_rebuttal_invalid_format(self, client):
        r = client.post("/api/rebuttal",
                        json={"argument": "x", "stance": "liberal",
                              "format": "poem", "stream": False})
        assert r.status_code == 422

    def test_rebuttal_sse_stream(self, client, kb):
        src = _write_doc(kb)
        doc_id = client.post("/api/import",
                             json={"source": str(src)}).json()["doc_id"]
        client.post("/api/import/confirm",
                    json={"doc_id": doc_id, "stance": "liberal"})
        with client.stream("POST", "/api/rebuttal",
                           json={"argument": "计划经济优于市场",
                                 "stance": "liberal", "stream": True}) as r:
            assert r.status_code == 200
            body = "".join(r.iter_text())
        assert "event: meta" in body
        assert "event: delta" in body
        assert "event: done" in body
