"""SQLite 存储层：documents/chapters/chunks/arg_units + FTS5 全文索引 + 级联删除 + 断点恢复。

FTS5 中文方案：入库时 jieba 预分词（空格分隔）写入 fts_index.content，
查询时同样 jieba 分词，用默认 unicode61 tokenizer 即可正确匹配词组。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import jieba

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from storage.base import MetadataStoreBase
from storage.workspace_store import WorkspaceMixin

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
    translator   TEXT,
    publisher    TEXT,
    edition      TEXT,
    original_title TEXT,
    original_lang  TEXT,
    author_years   TEXT,
    school       TEXT,
    year_raw     TEXT,
    manual_fields TEXT,
    review_status TEXT DEFAULT 'approved',
    created_at   TEXT,
    updated_at   TEXT,
    deleted_at   TEXT,
    relations_at TEXT  /* 0.1.9 E1：关系边配对记账时间戳 */
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
CREATE TABLE IF NOT EXISTS basket (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type   TEXT NOT NULL,          -- chunk | arg_unit | document
    ref_id      TEXT NOT NULL,
    excerpt     TEXT NOT NULL,
    source      TEXT DEFAULT '',
    used        INTEGER DEFAULT 0,
    added_at    TEXT,
    group_id    INTEGER,                -- 0.1.4 批 4：所属素材组（必属一组）
    UNIQUE (item_type, ref_id)
);
CREATE TABLE IF NOT EXISTS material_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    pinned      INTEGER DEFAULT 0,      -- 1 = 公共素材组（永置顶不可删改）
    created_at  TEXT
);
CREATE TABLE IF NOT EXISTS responses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    intent         TEXT NOT NULL,       -- rebut|critique|evaluate|analyze|report
    stance         TEXT DEFAULT '',
    input_text     TEXT NOT NULL,
    output_text    TEXT NOT NULL,
    citations_json TEXT DEFAULT '[]',
    provider       TEXT DEFAULT '',
    starred        INTEGER DEFAULT 0,
    created_at     TEXT
);
CREATE TABLE IF NOT EXISTS highlights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      TEXT NOT NULL,           -- 0.1.8 N3：阅读器高亮批注
    quote       TEXT NOT NULL,           -- 高亮引文（文本锚点主体）
    prefix      TEXT DEFAULT '',         -- 前文 32 字符（重定位容错）
    suffix      TEXT DEFAULT '',         -- 后文 32 字符
    color       TEXT DEFAULT 'yellow',
    note        TEXT DEFAULT '',
    created_at  TEXT
);
"""

# 覆盖索引单独执行：必须在列迁移之后建（旧库先补列再建索引，
# 否则引用新列的索引在 0.1.0 旧库上直接报 no such column）
_INDEXES = """
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
# 外键约束仅对全新库生效，旧库靠业务层级联逻辑保底。
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("basket", "group_id", "INTEGER"),      # 0.1.4 批 4：素材必属一组
    ("documents", "content_hash", "TEXT"),
    ("documents", "source_path", "TEXT"),
    ("documents", "created_at", "TEXT"),
    ("documents", "updated_at", "TEXT"),
    ("documents", "deleted_at", "TEXT"),
    ("chapters", "created_at", "TEXT"),
    ("chunks", "created_at", "TEXT"),
    ("arg_units", "chunk_id", "TEXT"),
    ("arg_units", "evidence", "TEXT"),
    ("arg_units", "thinker", "TEXT"),
    ("arg_units", "school", "TEXT"),
    ("arg_units", "relation", "TEXT"),
    ("arg_units", "target_unit_id", "TEXT"),
    ("arg_units", "created_at", "TEXT"),
    # 0.1.3 B1：文档元数据扩展（与 _DOC_META_COLS、_SCHEMA 三处同步）
    ("documents", "translator", "TEXT"),
    ("documents", "publisher", "TEXT"),
    ("documents", "edition", "TEXT"),
    ("documents", "original_title", "TEXT"),
    ("documents", "original_lang", "TEXT"),
    ("documents", "author_years", "TEXT"),
    ("documents", "school", "TEXT"),
    ("documents", "manual_fields", "TEXT"),
    # 0.1.5 I2：日期原文回显（year 存整数年接筛选，year_raw 存原文）
    ("documents", "year_raw", "TEXT"),
    # 0.1.8 M2：批量导入待审队列（旧库存量默认 approved）
    ("documents", "review_status", "TEXT DEFAULT 'approved'"),
    # 0.1.9 E1: 关系边增量更新记账
    ("documents", "relations_at", "TEXT"),
]


def _tokenize(text: str) -> str:
    """jieba 分词，空格分隔（FTS5 unicode61 可直接索引）。"""
    return " ".join(t for t in jieba.cut_for_search(text) if t.strip())


class SqliteStore(WorkspaceMixin, MetadataStoreBase):
    def __init__(self, db_path: Path | str | None = None):
        self.path = Path(db_path) if db_path else config.SQLITE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False：FastAPI 同步端点跑在线程池，连接需跨线程复用
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        # 服务器级规范：WAL 并发模式 + 严格外键
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(_SCHEMA)
        self._migrate()
        self.conn.executescript(_INDEXES)
        self.conn.commit()
        self._migrate_years()   # 0.1.9 D1：存量年份重解析（幂等）
        # 0.1.4 批 4：公共素材组常在；旧库存量素材（group_id 空）归公共组
        pub = self._ensure_public_group()
        self.conn.execute(
            "UPDATE basket SET group_id=? WHERE group_id IS NULL", (pub,))
        self.conn.commit()

    def _migrate(self) -> None:
        """增量列迁移：对旧库补齐新列（幂等，按 PRAGMA table_info 判断）。"""
        for table, column, decl in _MIGRATIONS:
            cols = {r["name"] for r in
                    self.conn.execute(f"PRAGMA table_info({table})")}
            if column not in cols:
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    def _migrate_years(self) -> None:
        """0.1.9 D1：一次性存量年份迁移。year 超范围(-3000..2600)的文档，
        从 year_raw / 原值重解析（如 20260501120137 → 2026）；manual_fields 含 year
        的跳过（手动最高优先）；无法解析置 NULL。幂等：修好后不再触碰。"""
        from lib.years import sane_year
        try:
            rows = self.conn.execute(
                "SELECT doc_id, year, year_raw, manual_fields FROM documents "
                "WHERE year IS NOT NULL AND (year < -3000 OR year > 2600)").fetchall()
        except sqlite3.OperationalError:
            return   # 列尚未就绪（极早期库），下次启动再跑
        for r in rows:
            try:
                manual = json.loads(r["manual_fields"]) if r["manual_fields"] else []
            except Exception:
                manual = []
            if "year" in manual:
                continue
            yi, yr = None, None
            for cand in (r["year_raw"], str(r["year"])):
                if not cand:
                    continue
                yi, yr = sane_year(cand)
                if yi is not None:
                    break
            if yi is not None:
                self.conn.execute(
                    "UPDATE documents SET year=?, year_raw=? WHERE doc_id=?",
                    (yi, yr, r["doc_id"]))
            else:
                self.conn.execute(
                    "UPDATE documents SET year=NULL WHERE doc_id=?", (r["doc_id"],))
        if rows:
            self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---------- documents ----------
    # 0.1.3 元数据列（B1）：schema/迁移/本清单三处必须同步，防分享包丢字段
    _DOC_META_COLS = ("translator", "publisher", "edition", "original_title",
                      "original_lang", "author_years", "school", "year_raw",
                      "manual_fields")
    
    def upsert_document(self, doc: dict) -> None:
        """UPSERT：重复写入保留 created_at，只更 updated_at（服务器级规范）。"""
        meta_cols = ",".join(self._DOC_META_COLS)
        meta_sets = ",".join(f"{c}=excluded.{c}" for c in self._DOC_META_COLS)
        self.conn.execute(
            f"""INSERT INTO documents
               (doc_id,title,author,year,stance,secondary_stances,source_type,
                source_url,import_date,quality_score,summary,provenance,
                content_hash,source_path,{meta_cols},created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,{",".join("?" * len(self._DOC_META_COLS))},datetime('now'),datetime('now'))
               ON CONFLICT(doc_id) DO UPDATE SET
                 title=excluded.title, author=excluded.author, year=excluded.year,
                 stance=excluded.stance,
                 secondary_stances=excluded.secondary_stances,
                 source_type=excluded.source_type, source_url=excluded.source_url,
                 import_date=excluded.import_date,
                 quality_score=excluded.quality_score, summary=excluded.summary,
                 provenance=excluded.provenance,
                 content_hash=excluded.content_hash,
                 source_path=excluded.source_path,{meta_sets},
                 deleted_at=NULL, updated_at=datetime('now')""",
            (doc["doc_id"], doc.get("title"), doc.get("author"),
             doc.get("year"), doc.get("stance"),
             json.dumps(doc.get("secondary_stances", []), ensure_ascii=False),
             doc.get("source_type"), doc.get("source_url"),
             doc.get("import_date"), doc.get("quality_score"),
             doc.get("summary"),
             json.dumps(doc.get("provenance", {}), ensure_ascii=False),
             doc.get("content_hash"), doc.get("source_path"),
             *(doc.get(c) for c in self._DOC_META_COLS)))
        self.conn.commit()
    
    def update_document_fields(self, doc_id: str, fields: dict) -> bool:
        """元数据字段级编辑（B5）：白名单列；手动改过的字段记入 manual_fields，
        联网补充不得覆盖（手动>正文>文件名>网上）。"""
        allowed = {"title", "author", "year", "stance",
                   *self._DOC_META_COLS} - {"manual_fields"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return False
        row = self.conn.execute(
            "SELECT manual_fields FROM documents WHERE doc_id=?",
            (doc_id,)).fetchone()
        if row is None:
            return False
        try:
            manual = set(json.loads(row["manual_fields"] or "[]"))
        except (json.JSONDecodeError, TypeError):
            manual = set()
        manual |= set(sets)
        assign = ",".join(f"{k}=?" for k in sets)
        self.conn.execute(
            f"UPDATE documents SET {assign}, manual_fields=?, "
            "updated_at=datetime('now') WHERE doc_id=?",
            (*sets.values(), json.dumps(sorted(manual), ensure_ascii=False),
             doc_id))
        self.conn.commit()
        return True

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

    # ---------- 0.1.8 M2：待审队列 ----------
    def pending_doc_ids(self) -> set[str]:
        """待审文档 id 集：检索/图谱/脉络/素材来源查询统一过滤用。"""
        rows = self.conn.execute(
            "SELECT doc_id FROM documents "
            "WHERE review_status='pending' AND deleted_at IS NULL").fetchall()
        return {r["doc_id"] for r in rows}

    def set_review_status(self, doc_id: str, status: str) -> bool:
        cur = self.conn.execute(
            "UPDATE documents SET review_status=?, updated_at=datetime('now') "
            "WHERE doc_id=? AND deleted_at IS NULL", (status, doc_id))
        self.conn.commit()
        return cur.rowcount > 0

    # ---------- 0.1.9 E1: 关系边记账（relations_at）管理 ----------
    def mark_relations_built(self, doc_ids: list[str] | None = None) -> bool:
        """配对完成时打标：给定文档集或全库打上当前时间戳。"""
        now = datetime.now().isoformat()
        if doc_ids:
            ids_placeholder = ",".join("?" * len(doc_ids))
            cur = self.conn.execute(
                f"UPDATE documents SET relations_at=? WHERE doc_id IN ({ids_placeholder}) AND deleted_at IS NULL",
                [now] + doc_ids)
        else:
            cur = self.conn.execute(
                "UPDATE documents SET relations_at=? WHERE deleted_at IS NULL", (now,))
        self.conn.commit()
        return cur.rowcount > 0

    def count_relations_pending(self) -> int:
        """统计 relations_at IS NULL 的文档数（未配对过或重提取后待更新）。"""
        row = self.conn.execute(
            "SELECT COUNT(*) as n FROM documents WHERE relations_at IS NULL AND deleted_at IS NULL").fetchone()
        return row["n"] if row else 0

    def clear_relations_at(self, doc_ids: list[str]) -> bool:
        """重提取时清空指定文档的关系边记账，以便增量重建时使用。"""
        if not doc_ids:
            return True
        ids_placeholder = ",".join("?" * len(doc_ids))
        cur = self.conn.execute(
            f"UPDATE documents SET relations_at=NULL WHERE doc_id IN ({ids_placeholder}) AND deleted_at IS NULL",
            doc_ids)
        self.conn.commit()
        return cur.rowcount > 0

    def approve_all(self) -> int:
        cur = self.conn.execute(
            "UPDATE documents SET review_status='approved', "
            "updated_at=datetime('now') "
            "WHERE review_status='pending' AND deleted_at IS NULL")
        self.conn.commit()
        return cur.rowcount

    # ---------- 0.1.8 N3：阅读器高亮批注 ----------
    def highlight_add(self, doc_id: str, quote: str, prefix: str = "",
                      suffix: str = "", color: str = "yellow",
                      note: str = "") -> int:
        cur = self.conn.execute(
            "INSERT INTO highlights (doc_id,quote,prefix,suffix,color,note,"
            "created_at) VALUES (?,?,?,?,?,?,datetime('now'))",
            (doc_id, quote, prefix, suffix, color, note))
        self.conn.commit()
        return int(cur.lastrowid or 0)

    def highlight_list(self, doc_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM highlights WHERE doc_id=? ORDER BY id",
            (doc_id,)).fetchall()
        return [dict(r) for r in rows]

    def highlight_delete(self, hl_id: int) -> int:
        cur = self.conn.execute("DELETE FROM highlights WHERE id=?", (hl_id,))
        self.conn.commit()
        return cur.rowcount

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

    def update_arg_relation(self, arg_id: str, relation: str | None,
                            target_unit_id: str | None) -> int:
        """写回对齐引擎判定的关系边（项目16；None=清除）。"""
        cur = self.conn.execute(
            "UPDATE arg_units SET relation=?, target_unit_id=? WHERE arg_id=?",
            (relation, target_unit_id, arg_id))
        self.conn.commit()
        return cur.rowcount

    def update_arg_unit(self, arg_id: str, fields: dict) -> int:
        """图谱人工纠错：只允许改白名单字段。"""
        allowed = {k: v for k, v in fields.items()
                   if k in ("claim", "evidence", "thinker", "school",
                            "relation", "target_unit_id")}
        if not allowed:
            return 0
        sets = ", ".join(f"{k}=?" for k in allowed)
        cur = self.conn.execute(
            f"UPDATE arg_units SET {sets} WHERE arg_id=?",
            (*allowed.values(), arg_id))
        self.conn.commit()
        return cur.rowcount

    def delete_arg_unit(self, arg_id: str) -> int:
        """删单元并清掉指向它的关系边（避免悬挂引用）。"""
        self.conn.execute(
            "UPDATE arg_units SET relation=NULL, target_unit_id=NULL "
            "WHERE target_unit_id=?", (arg_id,))
        cur = self.conn.execute(
            "DELETE FROM arg_units WHERE arg_id=?", (arg_id,))
        self.conn.commit()
        return cur.rowcount

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
        元数据可恢复）；硬删：五表级联物理删除。LanceDB 删除由调用方负责。
        0.1.8 M5 级联补全：basket 标注「来源已删」、跨文档关系边清 NULL、
        highlights 随文档删；responses 不动（历史卡前端兜底显「来源已删」）。"""
        c = self.conn
        counts: dict = {}
        # M5：被删文档名下的引用 id 集（doc_id/chunk_id/arg_id）先收集
        ref_ids = [doc_id]
        ref_ids += [r["chunk_id"] for r in c.execute(
            "SELECT chunk_id FROM chunks WHERE doc_id=?", (doc_id,))]
        arg_ids = [r["arg_id"] for r in c.execute(
            "SELECT arg_id FROM arg_units WHERE doc_id=?", (doc_id,))]
        ref_ids += arg_ids
        # basket：保留摘录可用，来源名追加标注（只标一次）
        if ref_ids:
            ph = ",".join("?" * len(ref_ids))
            cur = c.execute(
                f"UPDATE basket SET source = source || '（来源已删）' "
                f"WHERE ref_id IN ({ph}) AND source NOT LIKE '%（来源已删）'",
                ref_ids)
            counts["basket_marked"] = cur.rowcount
        # 跨文档关系边：指向被删单元的 relation/target 清 NULL（防幽灵边）
        if arg_ids:
            ph = ",".join("?" * len(arg_ids))
            cur = c.execute(
                f"UPDATE arg_units SET relation=NULL, target_unit_id=NULL "
                f"WHERE target_unit_id IN ({ph}) AND doc_id != ?",
                (*arg_ids, doc_id))
            counts["edges_cleared"] = cur.rowcount
        # highlights 随文档删（N3）
        cur = c.execute("DELETE FROM highlights WHERE doc_id=?", (doc_id,))
        counts["highlights"] = cur.rowcount
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
