"""入库流水线统筹：Stage 0-10 串联，断点恢复，两段式（预览→确认）。

Stage 0  解析（Docling/降级）    Stage 6  立场自动分类
Stage 1  TOC/标题切割            Stage 7  写入 SQLite + LanceDB
Stage 2  BGE-M3 向量化           Stage 8  生成 meta.json
Stage 3  章节摘要                Stage 9  归档 source.*
Stage 4  全书总结+意识形态分析    Stage 10 更新 INDEX.md
Stage 5  坐标提取
每章级 Stage 完成即写 ingestion_progress，重跑自动跳过 done 阶段。
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import Timer, log_ingestion, new_trace_id
from ingestion.chunker import Chunk, chunk_document, estimate_tokens
from ingestion.classifier import classify_stance, extract_coordinates
from ingestion.parsers import ParsedDocument, parse_any
from ingestion.summarizer import summarize_chapter, summarize_document
from models.embedder import get_embedder
from models.model_router import ModelRouter, get_router
from storage.lance_store import VectorStoreBase, get_vector_store
from storage.sqlite_store import SqliteStore


@dataclass
class ImportPreview:
    """Stage 0-6 的产物，等待用户确认立场后完成 Stage 7-10。"""
    doc_id: str
    trace_id: str
    source: str
    parsed: ParsedDocument
    chunks: list[Chunk]
    chapter_summaries: list[str] = field(default_factory=list)
    doc_summary: str = ""
    coordinates: dict = field(default_factory=dict)
    classification: dict = field(default_factory=dict)
    token_estimate: int = 0

    def to_dict(self) -> dict:
        return {"doc_id": self.doc_id, "trace_id": self.trace_id,
                "source": self.source, "title": self.parsed.title,
                "author": self.parsed.author, "year": self.parsed.year,
                "source_type": self.parsed.source_type,
                "chapters": len(self.parsed.sections),
                "chunks": len(self.chunks),
                "token_estimate": self.token_estimate,
                "doc_summary": self.doc_summary,
                "coordinates": self.coordinates,
                "classification": self.classification}


# API 两段式导入的内存暂存区
PENDING: dict[str, ImportPreview] = {}


def _doc_id_for(source: str) -> str:
    """同一来源重复导入得到相同 doc_id（幂等 + 断点恢复的前提）。"""
    h = hashlib.sha256(str(source).encode("utf-8")).hexdigest()[:12]
    return f"doc_{h}"


class Indexer:
    def __init__(self, sqlite: SqliteStore | None = None,
                 vectors: VectorStoreBase | None = None,
                 router: ModelRouter | None = None):
        self.db = sqlite or SqliteStore()
        self.vec = vectors or get_vector_store()
        self.router = router or get_router()

    # ---------- 断点辅助 ----------
    def _done(self, doc_id: str, chapter_id: str, stage: str) -> bool:
        return self.db.get_progress(doc_id, chapter_id, stage) == "done"

    def _mark(self, doc_id: str, chapter_id: str, stage: str,
              status: str = "done") -> None:
        self.db.set_progress(doc_id, chapter_id, stage, status)

    # ---------- Stage 0-6：预览 ----------
    def preview(self, source: str, trace_id: str | None = None) -> ImportPreview:
        trace_id = trace_id or new_trace_id()
        doc_id = _doc_id_for(source)

        with Timer() as t:
            parsed = parse_any(source)                     # Stage 0
        log_ingestion(trace_id, "stage_done", doc_id, stage="parse",
                      status="done", duration_ms=t.ms)

        chunks = chunk_document(parsed)                    # Stage 1
        if not chunks:
            raise ValueError(f"文档无可入库内容: {source}")
        log_ingestion(trace_id, "stage_done", doc_id, stage="chunk",
                      status="done", chunks=len(chunks))

        # Stage 3 章节摘要（带断点：已 done 的章节从缓存复用）
        summaries: list[str] = []
        for i, ch in enumerate(chunks):
            chap_id = f"{doc_id}_ch{i:03d}"
            cached = self._load_cached_summary(doc_id, chap_id)
            if self._done(doc_id, chap_id, "summarized") and cached:
                summaries.append(cached)
                continue
            s = summarize_chapter(ch.chapter_title, ch.text,
                                  router=self.router, trace_id=trace_id)
            summaries.append(s)
            self._cache_summary(doc_id, chap_id, s)
            self._mark(doc_id, chap_id, "summarized")
        log_ingestion(trace_id, "stage_done", doc_id, stage="summarize",
                      status="done")

        # Stage 4 全书总结 + Stage 5 坐标
        doc_summary = summarize_document(summaries, router=self.router,
                                         trace_id=trace_id) if summaries else ""
        coords = extract_coordinates(doc_summary or parsed.title,
                                     router=self.router, trace_id=trace_id)
        log_ingestion(trace_id, "stage_done", doc_id, stage="ideology",
                      status="done")

        # Stage 6 立场分类
        cls = classify_stance(doc_summary or parsed.full_text[:2000],
                              router=self.router, trace_id=trace_id)
        log_ingestion(trace_id, "stage_done", doc_id, stage="classify",
                      status="done", stance=cls["stance"])

        pv = ImportPreview(
            doc_id=doc_id, trace_id=trace_id, source=str(source),
            parsed=parsed, chunks=chunks, chapter_summaries=summaries,
            doc_summary=doc_summary, coordinates=coords, classification=cls,
            token_estimate=sum(c.token_count for c in chunks))
        PENDING[doc_id] = pv
        return pv

    # ---------- Stage 7-10：确认入库 ----------
    def confirm(self, preview: ImportPreview, stance: str) -> dict:
        pv, doc_id, trace_id = preview, preview.doc_id, preview.trace_id
        emb = get_embedder()

        # Stage 7a 文档 + 章节 + chunk 写 SQLite
        self.db.upsert_document({
            "doc_id": doc_id, "title": pv.parsed.title,
            "author": pv.parsed.author, "year": pv.parsed.year,
            "stance": stance, "source_type": pv.parsed.source_type,
            "source_url": pv.source if pv.parsed.source_type == "url" else None,
            "import_date": date.today().isoformat(),
            "quality_score": pv.classification.get("confidence", 0.5),
            "summary": pv.doc_summary,
            "provenance": {"source": pv.source,
                           "coordinates": pv.coordinates,
                           "classification": pv.classification}})

        texts = [c.text for c in pv.chunks]
        # Stage 2 向量化（批量，此处执行以免预览阶段白算未确认的文档）
        vectors = emb.embed_batch(texts)

        n_chunks = 0
        for i, (ch, vec) in enumerate(zip(pv.chunks, vectors)):
            chap_id = f"{doc_id}_ch{i:03d}"
            chunk_id = f"{doc_id}_c{i:04d}"
            if self._done(doc_id, chap_id, "vectorized"):
                continue
            self.db.upsert_chapter({
                "chapter_id": chap_id, "doc_id": doc_id,
                "chapter_num": ch.chapter_num, "title": ch.chapter_title,
                "page_range": ch.page_range, "token_count": ch.token_count,
                "summary": pv.chapter_summaries[i]
                if i < len(pv.chapter_summaries) else ""})
            self.db.insert_chunk({
                "chunk_id": chunk_id, "chapter_id": chap_id, "doc_id": doc_id,
                "text": ch.text, "page_range": ch.page_range,
                "embedding_model": emb.name, "embedding_dim": emb.dim})
            self.vec.add(chunk_id, doc_id, vec, emb.name)
            self._mark(doc_id, chap_id, "vectorized")
            n_chunks += 1
        log_ingestion(trace_id, "stage_done", doc_id, stage="store",
                      status="done", chunks=n_chunks)

        # Stage 8 meta.json
        stance_dir = config.STANCES_PATH / stance
        stance_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "doc_id": doc_id, "title": pv.parsed.title,
            "author": pv.parsed.author, "year": pv.parsed.year,
            "stance": stance, "source_type": pv.parsed.source_type,
            "import_date": date.today().isoformat(),
            "summary": pv.doc_summary, "coordinates": pv.coordinates,
            "classification": pv.classification,
            "chapters": [{"num": c.chapter_num, "title": c.chapter_title,
                          "pages": c.page_range, "tokens": c.token_count}
                         for c in pv.chunks],
            "embedding_model": emb.name}
        meta_path = stance_dir / f"{doc_id}.meta.json"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                             encoding="utf-8")

        # Stage 9 归档源文件
        src = Path(pv.source)
        if src.exists() and src.is_file():
            config.SOURCE_FILES_PATH.mkdir(parents=True, exist_ok=True)
            dst = config.SOURCE_FILES_PATH / f"{doc_id}{src.suffix}"
            if not dst.exists():
                shutil.copy2(src, dst)

        # Stage 10 INDEX.md
        self._update_index()
        log_ingestion(trace_id, "import_complete", doc_id, stage="finalize",
                      status="done")
        PENDING.pop(doc_id, None)
        return {"doc_id": doc_id, "stance": stance, "chunks": len(pv.chunks),
                "meta_path": str(meta_path)}

    def _update_index(self) -> None:
        docs = self.db.list_documents()
        lines = ["# 知识库索引", "",
                 f"共 {len(docs)} 篇文档。", "",
                 "| doc_id | 标题 | 作者 | 立场 | 导入日期 |",
                 "|---|---|---|---|---|"]
        for d in docs:
            lines.append(f"| {d['doc_id']} | {d.get('title') or '-'} "
                         f"| {d.get('author') or '-'} | {d.get('stance') or '-'} "
                         f"| {d.get('import_date') or '-'} |")
        config.INDEX_MD_PATH.parent.mkdir(parents=True, exist_ok=True)
        config.INDEX_MD_PATH.write_text("\n".join(lines) + "\n",
                                        encoding="utf-8")

    # ---------- 章节摘要缓存（断点恢复的数据面） ----------
    def _summary_cache_path(self, doc_id: str) -> Path:
        d = config.KNOWLEDGE_BASE_PATH / ".cache"
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{doc_id}.summaries.json"

    def _cache_summary(self, doc_id: str, chap_id: str, text: str) -> None:
        p = self._summary_cache_path(doc_id)
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        data[chap_id] = text
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def _load_cached_summary(self, doc_id: str, chap_id: str) -> str | None:
        p = self._summary_cache_path(doc_id)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8")).get(chap_id)

    # ---------- 一步式导入（CLI 用） ----------
    def import_document(self, source: str, stance: str | None = None) -> dict:
        pv = self.preview(source)
        final = stance or pv.classification["stance"]
        return self.confirm(pv, final)

    # ---------- 删除（五源级联） ----------
    def delete_document(self, doc_id: str) -> dict:
        counts = self.db.delete_document(doc_id)
        counts["vectors"] = self.vec.delete_doc(doc_id)
        for meta in config.STANCES_PATH.glob(f"*/{doc_id}.meta.json"):
            meta.unlink()
        cache = self._summary_cache_path(doc_id)
        if cache.exists():
            cache.unlink()
        self._update_index()
        return counts
