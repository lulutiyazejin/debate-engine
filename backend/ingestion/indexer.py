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

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import Timer, log_ingestion, new_trace_id
from ingestion.chunker import Chunk, chunk_document, estimate_tokens
from ingestion.classifier import classify_stance, extract_coordinates
from ingestion.parsers import ParsedDocument, parse_any
from ingestion.summarizer import (pick_strategy, summarize_chapter_with_args,
                                  summarize_document, summarize_full_context,
                                  summarize_refine)
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
    content_hash: str = ""
    duplicate: dict | None = None
    arg_units_by_chapter: list[list[dict]] = field(default_factory=list)
    author_recognized: str | None = None             # 0.1.3 B3
    web_enrich: dict = field(default_factory=dict)   # {fields, source, reports}

    def to_dict(self) -> dict:
        from ingestion.summarizer import _MAX_INPUT_CHARS
        return {"doc_id": self.doc_id, "trace_id": self.trace_id,
                "source": self.source, "title": self.parsed.title,
                "author": self.parsed.author, "year": self.parsed.year,
                "source_type": self.parsed.source_type,
                "chapters": len(self.parsed.sections),
                "chunks": len(self.chunks),
                "token_estimate": self.token_estimate,
                "long_chapters": sum(1 for c in self.chunks
                                     if len(c.text) > _MAX_INPUT_CHARS),  # F5
                "attachments": self.parsed.raw_metadata.get("attachments")
                               or [],   # 0.1.5 A5
                "doc_summary": self.doc_summary,
                "coordinates": self.coordinates,
                "classification": self.classification,
                "duplicate": self.duplicate,
                "enriched": self.web_enrich.get("author_rule") or "",  # 预览端用 author_rule 行
                "web_enrich": self.web_enrich}


# API 两段式导入的内存暂存区
PENDING: dict[str, ImportPreview] = {}


SUPPORTED_EXTS = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv",
                  ".txt", ".md", ".markdown"}


def collect_sources(inputs: list[str]) -> tuple[list[str], list[str]]:
    """展开目录为文件列表；返回 (可导入, 不支持的文件)。CLI 与批量 API 共用。"""
    sources: list[str] = []
    unsupported: list[str] = []
    for s in inputs:
        if s.lower().startswith(("http://", "https://")):
            sources.append(s)
            continue
        p = Path(s)
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    (sources if f.suffix.lower() in SUPPORTED_EXTS
                     else unsupported).append(str(f))
        else:
            sources.append(s)
    return sources, unsupported


def _content_hash(source: str, parsed: ParsedDocument) -> str:
    """内容哈希：本地文件哈希字节；URL/无文件哈希解析后正文。

    doc_id 由此而来：同内容得同 ID（换目录不重复入库）；
    内容改动得新 ID（配合 source_path 字段识别“新版本”）。
    """
    p = Path(source)
    if p.exists() and p.is_file():
        return hashlib.sha256(p.read_bytes()).hexdigest()
    return hashlib.sha256(parsed.full_text.encode("utf-8")).hexdigest()


def _doc_id_from_hash(content_hash: str) -> str:
    return f"doc_{content_hash[:12]}"


class Indexer:
    def __init__(self, sqlite: SqliteStore | None = None,
                 vectors: VectorStoreBase | None = None,
                 router: ModelRouter | None = None):
        self.db = sqlite or SqliteStore()
        self.vec = vectors or get_vector_store()
        self.router = router or get_router()

    # ---------- Stage X.5：导入预览扩展（B3） ----------
    def _enrich_preview(self, pv: ImportPreview) -> ImportPreview:
        """B3：web_enrich + author_rule；失败不阻塞，返回空 fields+reports。"""
        from ingestion.web_enrich import enrich as _enrich, enrichment_enabled as _enabled
        from storage.skill_loader import get_skill_loader
        try:
            if not _enabled():
                pv.web_enrich = {"fields": {}, "source": "", "reports": ["联网补充已关闭"]}
                return pv
            title = pv.parsed.summary.get("document_title") or pv.parsed.title
            author = pv.parsed.author or ""
            if not author and pv.source:
                import re, urllib.parse
                name = urllib.parse.unquote(Path(pv.source).name)
                m = re.search(r"[\u4e00-\u9fa5]{1,4}(?:著 | 编 | 译)[：:]?\s*([\u4e00-\u9fa5]{2,8})", name)
                if not m:
                    m = re.search(r"[\u4e00-\u9fa5]{3,10}", name)
                if m:
                    author = m.group(0)
            # AI 辨认 fallback→规则法（简单版）
            ai_author = ""
            try:
                skill = get_skill_loader().ingestion()
                prompt = skill.get("author_extract_prompt", "")
                if prompt:
                    from models.llm_client import Provider
                    # 有 Key 就走 AI，无 Key 走规则法
                    raise ImportError("NoKeyOrFallback")
            except Exception:
                pass
            pv.author_recognized = author or ai_author or ""
            res = _enrich(author=pv.author_recognized, title=title)
            pv.web_enrich = res
            # 只补空值（A3：edition 同轨）
            for k in ("translator", "publisher", "school", "author_years",
                      "edition"):
                if not res["fields"].get(k):
                    res["fields"].pop(k, None)
        except Exception:
            pv.web_enrich = {"fields": {}, "source": "", "reports": ["预览扩展失败"]}
            pv.author_recognized = ""
        return pv

    # ---------- 断点辅助 ----------
    def _done(self, doc_id: str, chapter_id: str, stage: str) -> bool:
        return self.db.get_progress(doc_id, chapter_id, stage) == "done"

    def _mark(self, doc_id: str, chapter_id: str, stage: str,
              status: str = "done") -> None:
        self.db.set_progress(doc_id, chapter_id, stage, status)

    # ---------- Stage 0-6：预览 ----------
    def preview(self, source: str, trace_id: str | None = None,
                parsed: ParsedDocument | None = None,
                strategy: str = "auto") -> ImportPreview:
        """parsed 可由 estimate() 预传，避免批量导入时解析双跑；
        strategy: auto|map_reduce|refine|full_context（项目5）。"""
        trace_id = trace_id or new_trace_id()

        if parsed is None:
            with Timer() as t:
                parsed = parse_any(source)                 # Stage 0
            ms = t.ms
        else:
            ms = 0
        # doc_id = 内容哈希（必须先解析：URL 类来源需要正文）
        content_hash = _content_hash(source, parsed)
        doc_id = _doc_id_from_hash(content_hash)
        log_ingestion(trace_id, "stage_done", doc_id, stage="parse",
                      status="done", duration_ms=ms)

        chunks = chunk_document(parsed)                    # Stage 1
        if not chunks:
            raise ValueError(f"文档无可入库内容: {source}")
        log_ingestion(trace_id, "stage_done", doc_id, stage="chunk",
                      status="done", chunks=len(chunks))

        # 查重前置（项目2）：exact 直接短路，不烧摘要/坐标/分类 API
        duplicate: dict | None = None
        existing = self.db.find_by_hash(content_hash)
        if existing:
            duplicate = {"type": "exact",
                         "existing_doc_id": existing["doc_id"],
                         "existing_title": existing.get("title")}
            log_ingestion(trace_id, "duplicate", doc_id, stage="dedup",
                          status="exact", existing=existing["doc_id"])
            pv = ImportPreview(
                doc_id=doc_id, trace_id=trace_id, source=str(source),
                parsed=parsed, chunks=chunks,
                token_estimate=sum(c.token_count for c in chunks),
                content_hash=content_hash, duplicate=duplicate)
            # 0.1.3 B3：web_enrich + author_rule（失败不阻塞）
            pv = self._enrich_preview(pv)
            PENDING[doc_id] = pv
            return pv
        same_path = self.db.find_by_source_path(str(source))
        if same_path and same_path["doc_id"] != doc_id:
            duplicate = {"type": "new_version",
                         "existing_doc_id": same_path["doc_id"],
                         "existing_title": same_path.get("title")}

        # Stage 3 章节摘要 + 论证单元合并提取（带断点：已 done 从缓存复用）
        summaries: list[str] = []
        arg_units_by_chapter: list[list[dict]] = []
        for i, ch in enumerate(chunks):
            chap_id = f"{doc_id}_ch{i:03d}"
            cached = self._load_cached_summary(doc_id, chap_id)
            if self._done(doc_id, chap_id, "summarized") and cached:
                if isinstance(cached, dict):   # 0.1.1 缓存：{summary, arg_units}
                    summaries.append(cached.get("summary", ""))
                    arg_units_by_chapter.append(cached.get("arg_units", []))
                else:                          # 0.1.0 旧缓存：纯文本
                    summaries.append(cached)
                    arg_units_by_chapter.append([])
                continue
            s, units = summarize_chapter_with_args(
                ch.chapter_title, ch.text, router=self.router,
                trace_id=trace_id, doc_type=parsed.source_type)
            summaries.append(s)
            arg_units_by_chapter.append(units)
            self._cache_summary(doc_id, chap_id,
                                {"summary": s, "arg_units": units})
            self._mark(doc_id, chap_id, "summarized")
        log_ingestion(trace_id, "stage_done", doc_id, stage="summarize",
                      status="done")

        # Stage 4 全书总结 + Stage 5 坐标 + Stage 6 分类（均带断点缓存）
        extras = self._load_doc_extras(doc_id)
        if self._done(doc_id, "__doc__", "doc_summary") and extras.get("doc_summary"):
            doc_summary = extras["doc_summary"]
        else:
            strat = pick_strategy(strategy,
                                  sum(c.token_count for c in chunks),
                                  router=self.router)   # F4：读槽 1 窗判墙
            if strat == "full_context":
                doc_summary = summarize_full_context(
                    parsed.full_text, router=self.router, trace_id=trace_id)
            elif strat == "refine":
                doc_summary = summarize_refine(
                    [(c.chapter_title, c.text) for c in chunks],
                    router=self.router, trace_id=trace_id)
            else:
                doc_summary = summarize_document(
                    summaries, router=self.router,
                    trace_id=trace_id) if summaries else ""
            self._cache_doc_extra(doc_id, "doc_summary", doc_summary)
            self._mark(doc_id, "__doc__", "doc_summary")
        if self._done(doc_id, "__doc__", "coordinates") and extras.get("coordinates"):
            coords = extras["coordinates"]
        else:
            coords = extract_coordinates(doc_summary or parsed.title,
                                         router=self.router, trace_id=trace_id)
            self._cache_doc_extra(doc_id, "coordinates", coords)
            self._mark(doc_id, "__doc__", "coordinates")
        log_ingestion(trace_id, "stage_done", doc_id, stage="ideology",
                      status="done")

        if self._done(doc_id, "__doc__", "classified") and extras.get("classification"):
            cls = extras["classification"]
        else:
            cls = classify_stance(doc_summary or parsed.full_text[:2000],
                                  router=self.router, trace_id=trace_id,
                                  doc_type=parsed.source_type)
            self._cache_doc_extra(doc_id, "classification", cls)
            self._mark(doc_id, "__doc__", "classified")
        log_ingestion(trace_id, "stage_done", doc_id, stage="classify",
                      status="done", stance=cls["stance"])

        # 语义近重复（需要摘要，故放 Stage 4 之后）
        if duplicate is None and doc_summary:
            duplicate = self._semantic_duplicate(doc_id, doc_summary)

        pv = ImportPreview(
            doc_id=doc_id, trace_id=trace_id, source=str(source),
            parsed=parsed, chunks=chunks, chapter_summaries=summaries,
            doc_summary=doc_summary, coordinates=coords, classification=cls,
            token_estimate=sum(c.token_count for c in chunks),
            content_hash=content_hash, duplicate=duplicate,
            arg_units_by_chapter=arg_units_by_chapter)
        PENDING[doc_id] = pv
        return pv

    # ---------- Stage 7-10：确认入库 ----------
    def confirm(self, preview: ImportPreview, stance: str,
                archive: str | None = None) -> dict:
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
            "content_hash": pv.content_hash,
            "source_path": str(pv.source),
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

        # Stage 7b 论证单元写入（chunk_id 回填，项目4；relation 留空供项目16）
        n_units = 0
        for i, units in enumerate(pv.arg_units_by_chapter):
            cid = f"{doc_id}_c{i:04d}"
            for u in units:
                n_units += 1
                self.db.insert_arg_unit({
                    "arg_id": f"{doc_id}_a{n_units:04d}",
                    "chunk_id": cid, "doc_id": doc_id,
                    "claim": u.get("claim"), "evidence": u.get("evidence"),
                    "logic_pattern": u.get("logic_pattern"),
                    "thinker": u.get("thinker") or None,
                    "school": u.get("school") or None,
                    "coordinates": pv.coordinates})
        if n_units:
            log_ingestion(trace_id, "stage_done", doc_id, stage="arg_units",
                          status="done", units=n_units)

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

        # Stage 8b 标准化 Markdown（人可读入库产物，项目5）
        md = ["---", f"title: {pv.parsed.title}",
              f"author: {pv.parsed.author or ''}",
              f"year: {pv.parsed.year or ''}", f"stance: {stance}",
              f"coordinates: {json.dumps(pv.coordinates, ensure_ascii=False)}",
              "---", "", "# 全书总结", "", pv.doc_summary or "（无）", "",
              "# 章节摘要", ""]
        for i, ch in enumerate(pv.chunks):
            s = pv.chapter_summaries[i] if i < len(pv.chapter_summaries) else ""
            md += [f"## {ch.chapter_title}", "", s, ""]
        md += ["# 论证单元", ""]
        for units in pv.arg_units_by_chapter:
            for u in units:
                who = "，".join(x for x in (u.get("thinker"), u.get("school")) if x)
                md.append(f"- **{u.get('claim')}**"
                          + (f"（{who}）" if who else "")
                          + (f" 论据：{u.get('evidence')}" if u.get("evidence") else ""))
        (stance_dir / f"{doc_id}.md").write_text("\n".join(md) + "\n",
                                                 encoding="utf-8")

        # Stage 9 归档源文件
        src = Path(pv.source)
        if src.exists() and src.is_file():
            config.SOURCE_FILES_PATH.mkdir(parents=True, exist_ok=True)
            dst = config.SOURCE_FILES_PATH / f"{doc_id}{src.suffix}"
            if not dst.exists():
                shutil.copy2(src, dst)

        # Stage 9b 档案库（0.1.4 批 6）：人可读 md + 原件按策略归档
        from ingestion import archiver
        policy = archive or config.load_settings().get("archive_policy")
        if policy in (None, "", "ask"):
            policy = "copy"
        arch = archiver.archive_document(
            doc_id, pv.parsed.title, pv.parsed.author, pv.parsed.year,
            stance, pv.source, pv.parsed.source_type,
            "\n\n".join(c.text for c in pv.chunks), pv.doc_summary or "",
            policy=policy)

        # Stage 10 INDEX.md
        self._update_index()
        log_ingestion(trace_id, "import_complete", doc_id, stage="finalize",
                      status="done")
        PENDING.pop(doc_id, None)
        return {"doc_id": doc_id, "stance": stance, "chunks": len(pv.chunks),
                "meta_path": str(meta_path), "archive": arch}

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

    def _cache_summary(self, doc_id: str, chap_id: str, value) -> None:
        """0.1.1：value 可为 str（旧）或 {summary, arg_units}（新）。"""
        p = self._summary_cache_path(doc_id)
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        data[chap_id] = value
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def _load_cached_summary(self, doc_id: str, chap_id: str) -> str | None:
        p = self._summary_cache_path(doc_id)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8")).get(chap_id)

    # ---------- 文档级阶段缓存（坐标/分类断点恢复，项目3） ----------
    def _cache_doc_extra(self, doc_id: str, key: str, value) -> None:
        p = self._summary_cache_path(doc_id)
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        data[f"__{key}__"] = value
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def _load_doc_extras(self, doc_id: str) -> dict:
        p = self._summary_cache_path(doc_id)
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k.strip("_"): v for k, v in data.items() if k.startswith("__")}

    # ---------- 语义近重复（全书摘要向量余弦，项目2） ----------
    def _semantic_duplicate(self, doc_id: str, doc_summary: str) -> dict | None:
        docs = [d for d in self.db.list_documents()
                if d.get("summary") and d["doc_id"] != doc_id]
        if not docs:
            return None
        emb = get_embedder()
        vecs = emb.embed_batch([doc_summary] + [d["summary"] for d in docs])
        q = np.asarray(vecs[0], dtype=np.float32)
        for d, v in zip(docs, vecs[1:]):
            v = np.asarray(v, dtype=np.float32)
            sim = float(q @ v / (np.linalg.norm(q) * np.linalg.norm(v) + 1e-9))
            if sim > 0.92:
                return {"type": "semantic", "existing_doc_id": d["doc_id"],
                        "existing_title": d.get("title"),
                        "similarity": round(sim, 3)}
        return None

    # ---------- 一步式导入（CLI/批量用） ----------
    def import_document(self, source: str, stance: str | None = None,
                        on_duplicate: str = "skip",
                        parsed: ParsedDocument | None = None,
                        strategy: str = "auto") -> dict:
        """on_duplicate: skip=静默跳过 / replace=删旧入新 / keep-both=两版共存。"""
        pv = self.preview(source, parsed=parsed, strategy=strategy)
        dup = pv.duplicate
        if dup:
            if on_duplicate == "replace":
                self.delete_document(dup["existing_doc_id"])
                if dup["type"] == "exact":
                    # exact 预览跳过了摘要/坐标/分类，删旧后补跑完整分析
                    pv = self.preview(source, parsed=parsed, strategy=strategy)
            elif dup["type"] == "exact":
                return {"doc_id": pv.doc_id, "skipped": "exact_duplicate",
                        "existing": dup["existing_doc_id"]}
            elif dup["type"] == "new_version" and on_duplicate == "skip":
                return {"doc_id": pv.doc_id, "skipped": "new_version_detected",
                        "existing": dup["existing_doc_id"]}
            # semantic 只提示不阻断；keep-both 照常入库
        final = stance or pv.classification.get("stance") or "unknown"
        return self.confirm(pv, final)

    # ---------- 批量预估（解析+切块，无 LLM 消耗） ----------
    def estimate(self, source: str) -> dict:
        parsed = parse_any(source)
        chunks = chunk_document(parsed)
        return {"source": str(source), "title": parsed.title,
                "chunks": len(chunks),
                "token_estimate": sum(c.token_count for c in chunks),
                "parsed": parsed}

    # ---------- 手动改立场（项目9：六处同步） ----------
    def reassign_stance(self, doc_id: str, new_stance: str) -> dict:
        """六处：documents.stance / meta.json 移动 / 标准化 .md 移动 /
        INDEX.md 重生成 / 检索权重（StanceRouter 每次现算天然生效）/ 日志。"""
        doc = self.db.get_document(doc_id)
        if doc is None:
            raise ValueError(f"文档不存在: {doc_id}")
        old = doc.get("stance") or ""
        if old == new_stance:
            return {"doc_id": doc_id, "stance": new_stance, "moved": []}
        # 1) documents.stance（DB 行里 JSON 字符串先还原，避免双重编码）
        doc["stance"] = new_stance
        doc["secondary_stances"] = json.loads(doc.get("secondary_stances") or "[]")
        doc["provenance"] = json.loads(doc.get("provenance") or "{}")
        self.db.upsert_document(doc)
        # 2/3) meta.json 与标准化 .md 移动到新立场目录
        new_dir = config.STANCES_PATH / new_stance
        new_dir.mkdir(parents=True, exist_ok=True)
        moved: list[str] = []
        for p in config.STANCES_PATH.glob(f"*/{doc_id}.meta.json"):
            data = json.loads(p.read_text(encoding="utf-8"))
            data["stance"] = new_stance
            target = new_dir / p.name
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                              encoding="utf-8")
            if target != p:
                p.unlink()
            moved.append(str(target))
        for p in config.STANCES_PATH.glob(f"*/{doc_id}.md"):
            text = p.read_text(encoding="utf-8").replace(
                f"stance: {old}", f"stance: {new_stance}", 1)
            target = new_dir / p.name
            target.write_text(text, encoding="utf-8")
            if target != p:
                p.unlink()
            moved.append(str(target))
        # 4) INDEX.md 重生成；5) 检索权重无需动作；6) 日志；7) 档案库同步（0.1.4）
        from ingestion import archiver
        moved += archiver.move_archive(doc_id, new_stance)
        self._update_index()
        log_ingestion(new_trace_id(), "reassign", doc_id, stage="reassign",
                      status="done", old_stance=old, new_stance=new_stance)
        return {"doc_id": doc_id, "old_stance": old, "stance": new_stance,
                "moved": moved}

    # ---------- 删除（五源级联 + 可选档案） ----------
    def delete_document(self, doc_id: str, delete_archive: bool = False) -> dict:
        from ingestion import archiver
        counts = self.db.delete_document(doc_id)
        counts["vectors"] = self.vec.delete_doc(doc_id)
        for meta in config.STANCES_PATH.glob(f"*/{doc_id}.meta.json"):
            meta.unlink()
        for md in config.STANCES_PATH.glob(f"*/{doc_id}.md"):
            md.unlink()   # 级联第六处：标准化 Markdown（项目5）
        if delete_archive:   # 0.1.4 批 6：默认保留档案，显式要求才删
            counts["archive"] = archiver.delete_archive(doc_id)
        cache = self._summary_cache_path(doc_id)
        if cache.exists():
            cache.unlink()
        self._update_index()
        return counts
