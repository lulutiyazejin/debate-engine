"""确认落库（0.1.5 B3：从 indexer 拆出）。

两段式导入的后半程：Stage 7（SQLite+LanceDB 写入）→ Stage 8（meta.json/
标准化 md）→ Stage 9（源文件归档+档案库）→ Stage 10（INDEX.md）。
以 Mixin 回挂 Indexer（共用 db/vec/_done/_mark 等，调用方零改动）。
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import log_ingestion
from models.embedder import get_embedder


class ConfirmMixin:
    """Indexer 的确认落库半程（preview 半程留在 indexer.py）。"""

    def confirm(self, preview, stance: str,
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
                           "classification": pv.classification},
            "year_raw": getattr(pv.parsed, "_year_raw", None)})  # 0.1.9 D1

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
        from ingestion.indexer import PENDING   # 延迟导入避免环形依赖
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
