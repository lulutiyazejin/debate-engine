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
    provenance  TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
    chapter_id  TEXT PRIMARY KEY,
    doc_id      TEXT REFERENCES documents(doc_id),
    chapter_num INTEGER,
    title       TEXT,
    page_range  TEXT,
    token_count INTEGER,
    summary     TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id    TEXT PRIMARY KEY,
    chapter_id  TEXT,
    doc_id      TEXT,
    text        TEXT,
    page_range  TEXT,
    embedding_model TEXT,
    embedding_dim   INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
    doc_id UNINDEXED,
    chunk_id UNINDEXED,
    content
);
CREATE TABLE IF NOT EXISTS arg_units (
    arg_id      TEXT PRIMARY KEY,
    chunk_id    TEXT,
    doc_id      TEXT,
    claim       TEXT,
    logic_pattern TEXT,
    counter_targets TEXT,
    coordinates TEXT
);
CREATE TABLE IF NOT EXISTS ingestion_progress (
    doc_id      TEXT,
    chapter_id  TEXT,
    stage       TEXT,
    status      TEXT,
    PRIMARY KEY (doc_id, chapter_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chapters_doc ON chapters(doc_id);
CREATE INDEX IF NOT EXISTS idx_args_doc ON arg_units(doc_id);
"""


def _tokenize(text: str) -> str:
    """jieba 分词，空格分隔（FTS5 unicode61 可直接索引）。"""
    return " ".join(t for t in jieba.cut_for_search(text) if t.strip())


class SqliteStore:
    def __init__(self, db_path: Path | str | None = None):
        self.path = Path(db_path) if db_path else config.SQLITE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---------- documents ----------
    def upsert_document(self, doc: dict) -> None:
        self.conn.execute(
            """INSERT OR REPLACE INTO documents
               (doc_id,title,author,year,stance,secondary_stances,source_type,
                source_url,import_date,quality_score,summary,provenance)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (doc["doc_id"], doc.get("title"), doc.get("author"),
             doc.get("year"), doc.get("stance"),
             json.dumps(doc.get("secondary_stances", []), ensure_ascii=False),
             doc.get("source_type"), doc.get("source_url"),
             doc.get("import_date"), doc.get("quality_score"),
             doc.get("summary"),
             json.dumps(doc.get("provenance", {}), ensure_ascii=False)))
        self.conn.commit()

    def get_document(self, doc_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM documents WHERE doc_id=?", (doc_id,)).fetchone()
        return dict(row) if row else None

    def list_documents(self, stance: str | None = None) -> list[dict]:
        if stance:
            rows = self.conn.execute(
                "SELECT * FROM documents WHERE stance=? ORDER BY import_date DESC",
                (stance,)).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM documents ORDER BY import_date DESC").fetchall()
        return [dict(r) for r in rows]

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
               (arg_id,chunk_id,doc_id,claim,logic_pattern,counter_targets,coordinates)
               VALUES (?,?,?,?,?,?,?)""",
            (arg["arg_id"], arg.get("chunk_id"), arg["doc_id"],
             arg.get("claim"), arg.get("logic_pattern"),
             json.dumps(arg.get("counter_targets", []), ensure_ascii=False),
             json.dumps(arg.get("coordinates", {}), ensure_ascii=False)))
        self.conn.commit()

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

    # ---------- 级联删除 ----------
    def delete_document(self, doc_id: str) -> dict:
        """五源同步删除（SQLite 四表 + FTS）。LanceDB 删除由调用方负责。"""
        c = self.conn
        counts = {}
        for table in ("documents", "chapters", "chunks", "arg_units",
                      "ingestion_progress"):
            cur = c.execute(f"DELETE FROM {table} WHERE doc_id=?", (doc_id,))
            counts[table] = cur.rowcount
        cur = c.execute("DELETE FROM fts_index WHERE doc_id=?", (doc_id,))
        counts["fts_index"] = cur.rowcount
        c.commit()
        return counts

    # ---------- 统计 ----------
    def stats(self) -> dict:
        q = lambda sql: self.conn.execute(sql).fetchone()[0]
        return {
            "documents": q("SELECT COUNT(*) FROM documents"),
            "chapters": q("SELECT COUNT(*) FROM chapters"),
            "chunks": q("SELECT COUNT(*) FROM chunks"),
            "arg_units": q("SELECT COUNT(*) FROM arg_units"),
        }
