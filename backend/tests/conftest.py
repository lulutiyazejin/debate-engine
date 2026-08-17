"""pytest 共享夹具：隔离临时知识库路径 + 离线路由器 + 临时存储。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import config  # noqa: E402
from models.llm_client import OfflineProvider  # noqa: E402
from models.model_router import ModelRouter  # noqa: E402
from storage.lance_store import NumpyVectorStore  # noqa: E402
from storage.sqlite_store import SqliteStore  # noqa: E402


@pytest.fixture()
def kb(tmp_path, monkeypatch):
    """把所有运行时路径指到 tmp（Skill 目录保持真实，只读）。"""
    monkeypatch.setattr(config, "KNOWLEDGE_BASE_PATH", tmp_path)
    monkeypatch.setattr(config, "SQLITE_PATH", tmp_path / "knowledge.db")
    monkeypatch.setattr(config, "LANCE_PATH", tmp_path / "vector_store")
    monkeypatch.setattr(config, "STANCES_PATH", tmp_path / "stances")
    monkeypatch.setattr(config, "INBOX_PATH", tmp_path / "inbox")
    monkeypatch.setattr(config, "LOGS_PATH", tmp_path / "logs")
    monkeypatch.setattr(config, "SOURCE_FILES_PATH", tmp_path / "source_files")
    monkeypatch.setattr(config, "INDEX_MD_PATH", tmp_path / "INDEX.md")
    return tmp_path


@pytest.fixture()
def db(kb):
    store = SqliteStore(kb / "knowledge.db")
    yield store
    store.close()


@pytest.fixture()
def vec(kb):
    return NumpyVectorStore(kb / "vector_store")


@pytest.fixture()
def offline_router():
    """无任何云端服务商，直接走 OfflineProvider 兜底（测试确定性）。"""
    return ModelRouter(providers={"offline": OfflineProvider()})
