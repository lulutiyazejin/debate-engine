"""存储抽象层：业务代码只依赖本接口，不依赖具体数据库实现。

设计目标（PLAN-0.1.1 决策 9：服务器级规范 + 抽象层）：
- 默认实现 SQLite（单机零部署），未来数据规模/协作需求到位时
  编写 PostgresStore / 远程向量库实现类插入工厂即可，业务代码零改动。
- 接口只收录业务实际消费的方法，避免为想象中的需求造接口。
"""
from __future__ import annotations

import abc
from pathlib import Path

import numpy as np


class MetadataStoreBase(abc.ABC):
    """结构化元数据存储接口（documents/chapters/chunks/arg_units + 全文检索）。"""

    # ---- documents ----
    @abc.abstractmethod
    def upsert_document(self, doc: dict) -> None: ...

    @abc.abstractmethod
    def get_document(self, doc_id: str, include_deleted: bool = False) -> dict | None: ...

    @abc.abstractmethod
    def list_documents(self, stance: str | None = None) -> list[dict]: ...

    @abc.abstractmethod
    def find_by_hash(self, content_hash: str) -> dict | None: ...

    @abc.abstractmethod
    def find_by_source_path(self, source_path: str) -> dict | None: ...

    # ---- chapters / chunks / fts ----
    @abc.abstractmethod
    def upsert_chapter(self, ch: dict) -> None: ...

    @abc.abstractmethod
    def insert_chunk(self, chunk: dict) -> None: ...

    @abc.abstractmethod
    def get_chunk(self, chunk_id: str) -> dict | None: ...

    @abc.abstractmethod
    def fts_search(self, query: str, top_k: int = 20,
                   doc_ids: list[str] | None = None) -> list[dict]: ...

    # ---- arg_units ----
    @abc.abstractmethod
    def insert_arg_unit(self, arg: dict) -> None: ...

    # ---- 断点恢复 ----
    @abc.abstractmethod
    def set_progress(self, doc_id: str, chapter_id: str, stage: str,
                     status: str) -> None: ...

    @abc.abstractmethod
    def get_progress(self, doc_id: str, chapter_id: str, stage: str) -> str | None: ...

    # ---- 删除 / 统计 ----
    @abc.abstractmethod
    def delete_document(self, doc_id: str, hard: bool = False) -> dict: ...

    @abc.abstractmethod
    def stats(self) -> dict: ...

    @abc.abstractmethod
    def close(self) -> None: ...


class VectorStoreBase(abc.ABC):
    """向量存储接口（chunk 级向量的增/查/删/改名）。"""

    @abc.abstractmethod
    def add(self, chunk_id: str, doc_id: str, vector: np.ndarray,
            embedding_model: str) -> None: ...

    @abc.abstractmethod
    def search(self, vector: np.ndarray, top_k: int = 20,
               doc_ids: list[str] | None = None) -> list[dict]: ...

    @abc.abstractmethod
    def delete_doc(self, doc_id: str) -> int: ...

    @abc.abstractmethod
    def rename_doc(self, old_doc_id: str, new_doc_id: str) -> int:
        """doc_id 迁移（migrate 命令用）：返回改写的记录数。"""
        ...

    @abc.abstractmethod
    def count(self) -> int: ...


def get_metadata_store(db_path: Path | str | None = None) -> MetadataStoreBase:
    """工厂：按 config.STORAGE_BACKEND 选实现（当前仅 sqlite）。"""
    from storage.sqlite_store import SqliteStore
    return SqliteStore(db_path)
