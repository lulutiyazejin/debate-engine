"""SQLite 存储层：documents/chapters/chunks/arg_units + FTS5 全文索引 + 级联删除 + 断点恢复。

FTS5 中文方案：入库时 jieba 预分词（空格分隔）写入 fts_index.content，
查询时同样 jieba 分词，用默认 unicode61 tokenizer 即可正确匹配词组。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import jieba

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from storage.base import MetadataStoreBase

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id      TEXT PRIMARY KEY,
    title       TEXT,
    author      TEXT,
    year        INTEGER,
    stance      TEXT,
    secondary_stances TEXT,
    source_type TEXT,
    source_url  TEXT,
    import_date TEXT,
    quality_score REAL,
    summary     TEXT,
    provenance  TEXT,
    content_hash TEXT,
    source_path  TEXT,
    created_at   TEXT,
    updated_at   TEXT,
    deleted_at   TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
    chapter_id  TEXT PRIMARY KEY,
    doc_id      TEXT REFERENCES documents(doc_id) ON DELETE CASCADE,
    chapter_num INTEGER,
    title       TEXT,
    page_range  TEXT,
    token_count INTEGER,
    summary     TEXT,
    created_at  TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id    TEXT PRIMARY KEY,
    chapter_id  TEXT,
    doc_id      TEXT REFERENCES documents(doc_id) ON DELETE CASCADE,
    text        TEXT,
    page_range  TEXT,
    embedding_model TEXT,
    embedding_dim   INTEGER,
    created_at  TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
    doc_id UNINDEXED,
    chunk_id UNINDEXED,
    content
);
CREATE TABLE IF NOT EXISTS arg_units (
    arg_id      TEXT PRIMARY KEY,
    chunk_id    TEXT,
    doc_id      TEXT REFERENCES documents(doc_id) ON DELETE CASCADE,
    claim       TEXT,
    evidence    TEXT,
    logic_pattern TEXT,
    counter_targets TEXT,
    coordinates TEXT,
    thinker     TEXT,
    school      TEXT,
    relation    TEXT,
    target_unit_id TEXT,
    created_at  TEXT
);
CREATE TABLE IF NOT EXISTS ingestion_progress (
    doc_id      TEXT,
    chapter_id  TEXT,
    stage       TEXT,
    status      TEXT,
    PRIMARY KEY (doc_id, chapter_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapters_doc ON chapters(doc_id);
CREATE INDEX IF NOT EXISTS idx_args_doc ON arg_units(doc_id);
CREATE INDEX IF NOT EXISTS idx_args_chunk ON arg_units(chunk_id);
CREATE INDEX IF NOT EXISTS idx_docs_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_docs_srcpath ON documents(source_path);
CREATE INDEX IF NOT EXISTS idx_docs_stance ON documents(stance, deleted_at);
"""

# 旧库增量迁移：(表, 列, 列定义)。SQLite 不支持 ALTER 加外键，
# 外键约束仅对全新库生效，旧库靠业务层级联逻辑兑底。
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("documents", "content_hash", "TEXT"),
    ("documents", "source_path", "TEXT"),
    ("documents", "created_at", "TEXT"),
    ("documents", "updated_at", "TEXT"),
    ("documents", "deleted_at", "TEXT"),
    ("chapters", "created_at", "TEXT"),
    ("chunks", "created_at", "TEXT"),
    ("arg_units", "evidence", "TEXT"),
    ("arg_units", "thinker", "TEXT"),
    ("arg_units", "school", "TEXT"),
    ("arg_units", "relation", "TEXT"),
    ("arg_units", "target_unit_id", "TEXT"),
    ("arg_units", "created_at", "TEXT"),
]


def _tokenize(text: str) -> str:
    """jieba 分词，空格分隔（FTS5 unicode61 可直接索引）。"""
    return " ".join(t for t in jieba.cut_for_search(text) if t.strip())


class SqliteStore(MetadataStoreBase):
    def __init__(self, db_path: Path | str | None = None):
        self.path = Path(db_path) if db_path else config.SQLITE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        # 服务器级规范：WAL 并发模式 + 严格外键
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(_SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self) -> None:
        """增量列迁移：对旧库补齐新列（幂等，按 PRAGMA table_info 判断）。"""
        for table, column, decl in _MIGRATIONS:
            cols = {r["name"] for r in
                    self.conn.execute(f"PRAGMA table_info({table})")}
            if column not in cols:
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    def close(self) -> None:
        self.conn.close()

    # ---------- documents ----------
    def upsert_document(self, doc: dict) -> None:
        """UPSERT：重复写入保留 created_at，只刷 updated_at（服务器级规范）。"""
        self.conn.execute(
            """INSERT INTO documents
               (doc_id,title,author,year,stance,secondary_stances,source_type,
                source_url,import_date,quality_score,summary,provenance,
                content_hash,source_path,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
               ON CONFLICT(doc_id) DO UPDATE SET
                 title=excluded.title, author=excluded.author, year=excluded.year,
                 stance=excluded.stance,
                 secondary_stances=excluded.secondary_stances,
                 source_type=excluded.source_type, source_url=excluded.source_url,
                 import_date=excluded.import_date,
                 quality_score=excluded.quality_score, summary=excluded.summary,
                 provenance=excluded.provenance,
                 content_hash=excluded.content_hash,
                 source_path=excluded.source_path,
                 deleted_at=NULL, updated_at=datetime('now')""",
            (doc["doc_id"], doc.get("title"), doc.get("author"),
             doc.get("year"), doc.get("stance"),
             json.dumps(doc.get("secondary_stances", []), ensure_ascii=False),
             doc.get("source_type"), doc.get("source_url"),
             doc.get("import_date"), doc.get("quality_score"),
             doc.get("summary"),
             json.dumps(doc.get("provenance", {}), ensure_ascii=False),
             doc.get("content_hash"), doc.get("source_path")))
        self.conn.commit()

    def get_document(self, doc_id: str, include_deleted: bool = False) -> dict | None:
        sql = "SELECT * FROM documents WHERE doc_id=?"
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        row = self.conn.execute(sql, (doc_id,)).fetchone()
        return dict(row) if row else None

    def list_documents(self, stance: str | None = None) -> list[dict]:
        base = "SELECT * FROM documents WHERE deleted_at IS NULL"
        if stance:
            rows = self.conn.execute(
                base + " AND stance=? ORDER BY import_date DESC",
                (stance,)).fetchall()
        else:
            rows = self.conn.execute(
                base + " ORDER BY import_date DESC").fetchall()
        return [dict(r) for r in rows]

    def find_by_hash(self, content_hash: str) -> dict | None:
        """内容哈希查重（项目2 消费）。"""
        row = self.conn.execute(
            "SELECT * FROM documents WHERE content_hash=? AND deleted_at IS NULL",
            (content_hash,)).fetchone()
        return dict(row) if row else None

    def find_by_source_path(self, source_path: str) -> dict | None:
        """同路径不同内容 = 新版本（项目2 消费）。"""
        row = self.conn.execute(
            "SELECT * FROM documents WHERE source_path=? AND deleted_at IS NULL",
            (source_path,)).fetchone()
        return dict(row) if row else None

    # ---------- chapters ----------
    def upsert_chapter(self, ch: dict) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO chapters
               (chapter_id,doc_id,chapter_num,title,page_range,token_count,summary)
               VALUES (?,?,?,?,?,?,?)""",
            (ch["chapter_id"], ch["doc_id"], ch.get("chapter_num"),
             ch.get("title"), ch.get("page_range"),
             ch.get("token_count"), ch.get("summary")))
        self.conn.commit()

    # ---------- chunks + FTS ----------
    def insert_chunk(self, chunk: dict) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO chunks
               (chunk_id,chapter_id,doc_id,text,page_range,embedding_model,embedding_dim)
               VALUES (?,?,?,?,?,?,?)""",
            (chunk["chunk_id"], chunk.get("chapter_id"), chunk["doc_id"],
             chunk["text"], chunk.get("page_range"),
             chunk.get("embedding_model"), chunk.get("embedding_dim")))
        self.conn.execute(
            "INSERT INTO fts_index (doc_id,chunk_id,content) VALUES (?,?,?)",
            (chunk["doc_id"], chunk["chunk_id"], _tokenize(chunk["text"])))
        self.conn.commit()

    def get_chunk(self, chunk_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM chunks WHERE chunk_id=?", (chunk_id,)).fetchone()
        return dict(row) if row else None

    def fts_search(self, query: str, top_k: int = 20,
                   doc_ids: list[str] | None = None) -> list[dict]:
        """jieba 分词后 FTS5 BM25 检索。返回 [{chunk_id, doc_id, score}]"""
        tokens = [t for t in jieba.cut_for_search(query) if t.strip()]
        if not tokens:
            return []
        # OR 连接（宽松匹配），FTS5 语法特殊字符转义
        safe = [t.replace('"', '""') for t in tokens]
        match = " OR ".join(f'"{t}"' for t in safe)
        sql = ("SELECT chunk_id, doc_id, bm25(fts_index) AS score "
               "FROM fts_index WHERE fts_index MATCH ? ")
        params: list = [match]
        if doc_ids:
            sql += f"AND doc_id IN ({','.join('?'*len(doc_ids))}) "
            params += doc_ids
        sql += "ORDER BY score LIMIT ?"
        params.append(top_k)
        try:
            rows = self.conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            return []
        # bm25 越小越相关 → 归一化为越大越好
        return [{"chunk_id": r["chunk_id"], "doc_id": r["doc_id"],
                 "score": -float(r["score"])} for r in rows]

    # ---------- arg_units ----------
    def insert_arg_unit(self, arg: dict) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO arg_units
               (arg_id,chunk_id,doc_id,claim,evidence,logic_pattern,
                counter_targets,coordinates,thinker,school,relation,target_unit_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (arg["arg_id"], arg.get("chunk_id"), arg["doc_id"],
             arg.get("claim"), arg.get("evidence"), arg.get("logic_pattern"),
             json.dumps(arg.get("counter_targets", []), ensure_ascii=False),
             json.dumps(arg.get("coordinates", {}), ensure_ascii=False),
             arg.get("thinker"), arg.get("school"),
             arg.get("relation"), arg.get("target_unit_id")))
        self.conn.commit()

    def list_arg_units(self, doc_id: str | None = None) -> list[dict]:
        if doc_id:
            rows = self.conn.execute(
                "SELECT * FROM arg_units WHERE doc_id=?", (doc_id,)).fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM arg_units").fetchall()
        return [dict(r) for r in rows]

    # ---------- 断点恢复 ----------
    def set_progress(self, doc_id: str, chapter_id: str, stage: str,
                     status: str) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO ingestion_progress
               (doc_id,chapter_id,stage,status) VALUES (?,?,?,?)""",
            (doc_id, chapter_id, stage, status))
        self.conn.commit()

    def get_progress(self, doc_id: str, chapter_id: str, stage: str) -> str | None:
        row = self.conn.execute(
            """SELECT status FROM ingestion_progress
               WHERE doc_id=? AND chapter_id=? AND stage=?""",
            (doc_id, chapter_id, stage)).fetchone()
        return row["status"] if row else None

    # ---------- 级联删除（软删默认，硬删供清理/迁移） ----------
    def delete_document(self, doc_id: str, hard: bool = False) -> dict:
        """软删：documents 标记 deleted_at + 移除 FTS 行（检索即刻干净，
        元数据可恢复）；硬删：五表级联物理删除。LanceDB 删除由调用方负责。"""
        c = self.conn
        counts: dict = {}
        if hard:
            # 子表先删再删主表：避免新库外键 CASCADE 抢先清除导致计数失真
            for table in ("chapters", "chunks", "arg_units",
                          "ingestion_progress", "documents"):
                cur = c.execute(f"DELETE FROM {table} WHERE doc_id=?", (doc_id,))
                counts[table] = cur.rowcount
        else:
            cur = c.execute(
                "UPDATE documents SET deleted_at=datetime('now') "
                "WHERE doc_id=? AND deleted_at IS NULL", (doc_id,))
            counts["documents"] = cur.rowcount
        cur = c.execute("DELETE FROM fts_index WHERE doc_id=?", (doc_id,))
        counts["fts_index"] = cur.rowcount
        c.commit()
        return counts

    def purge_deleted(self) -> int:
        """清理所有软删文档（硬删级联），返回清理的文档数。"""
        rows = self.conn.execute(
            "SELECT doc_id FROM documents WHERE deleted_at IS NOT NULL").fetchall()
        for r in rows:
            self.delete_document(r["doc_id"], hard=True)
        return len(rows)

    # ---------- 统计（只计存活数据） ----------
    def stats(self) -> dict:
        q = lambda sql: self.conn.execute(sql).fetchone()[0]
        live = "SELECT doc_id FROM documents WHERE deleted_at IS NULL"
        return {
            "documents": q(f"SELECT COUNT(*) FROM ({live})"),
            "chapters": q(f"SELECT COUNT(*) FROM chapters WHERE doc_id IN ({live})"),
            "chunks": q(f"SELECT COUNT(*) FROM chunks WHERE doc_id IN ({live})"),
            "arg_units": q(f"SELECT COUNT(*) FROM arg_units WHERE doc_id IN ({live})"),
        }
