"""API 依赖：全局单例（应用生命周期内共享一套存储与引擎）。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.rebuttal_engine import RebuttalEngine
from ingestion.indexer import Indexer
from storage.sqlite_store import SqliteStore

_db: SqliteStore | None = None
_engine: RebuttalEngine | None = None
_indexer: Indexer | None = None


def get_db() -> SqliteStore:
    global _db
    if _db is None:
        _db = SqliteStore()
    return _db


def get_engine() -> RebuttalEngine:
    global _engine
    if _engine is None:
        _engine = RebuttalEngine(sqlite=get_db())
    return _engine


def get_indexer() -> Indexer:
    global _indexer
    if _indexer is None:
        _indexer = Indexer(sqlite=get_db())
    return _indexer
