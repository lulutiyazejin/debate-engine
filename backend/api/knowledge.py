"""知识库接口：文档列表/搜索/改立场/中心点预设；0.1.5：补摘要/档案浏览。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from api.deps import get_db, get_engine, get_indexer
from storage.skill_loader import get_skill_loader

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("/docs")
def list_docs(stance: str | None = None):
    db = get_db()
    return {"documents": db.list_documents(stance), "stats": db.stats()}


class StanceRequest(BaseModel):
    stance: str = Field(min_length=1)


@router.patch("/docs/{doc_id}/stance")
def reassign_stance(doc_id: str, req: StanceRequest):
    """手动改立场（项目9）：六处数据同步；供右键菜单直接调用。"""
    try:
        return get_indexer().reassign_stance(doc_id, req.stance)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/docs/{doc_id}/resummarize")
def resummarize(doc_id: str):
    """0.1.5 I3：补生成摘要——重跑 summarize 回写 documents.summary +
    档案 md 摘要段 + INDEX.md 重生成（离线导入后配好模型再补）。"""
    db = get_db()
    doc = db.get_document(doc_id)
    if doc is None:
        raise HTTPException(404, f"文档不存在: {doc_id}")
    from ingestion.summarizer import summarize_chapter, summarize_document
    rows = db.conn.execute(
        "SELECT summary FROM chapters WHERE doc_id=? ORDER BY chapter_id",
        (doc_id,)).fetchall()
    summaries = [r["summary"] for r in rows if r["summary"]]
    if not summaries:
        # 无章节摘要（离线入库）：取前几块正文现算
        rows = db.conn.execute(
            "SELECT text FROM chunks WHERE doc_id=? ORDER BY chunk_id",
            (doc_id,)).fetchall()
        title = doc.get("title") or doc_id
        summaries = [summarize_chapter(title, r["text"]) for r in rows[:6]]
        summaries = [s for s in summaries if s]
    if not summaries:
        raise HTTPException(502, "无可用正文，补摘要失败")
    new_sum = summarize_document(summaries).strip()
    if not new_sum or new_sum.startswith("（离线"):
        raise HTTPException(502, "摘要生成失败（当前无可用模型，请先配置）")
    db.conn.execute("UPDATE documents SET summary=? WHERE doc_id=?",
                    (new_sum, doc_id))
    db.conn.commit()
    # 档案 md 摘要段同步（summary-only 档才有摘要段）
    from ingestion import archiver
    for p in archiver.archive_paths(doc_id):
        path = Path(p)
        if path.suffix == ".md":
            try:
                txt = path.read_text(encoding="utf-8")
                if "# 摘要" in txt:
                    txt = re.sub(r"# 摘要\n\n.*?\n\n",
                                 f"# 摘要\n\n{new_sum}\n\n", txt,
                                 count=1, flags=re.S)
                    path.write_text(txt, encoding="utf-8")
            except OSError:
                pass
    get_indexer()._update_index()   # INDEX.md 重生成
    return {"doc_id": doc_id, "summary": new_sum}


# ---------- 0.1.5 D4：档案浏览 ----------

@router.get("/archive/tree")
def archive_tree():
    """档案树：立场→作者→文件（读 archive 目录；中立评价无作者层）。"""
    from ingestion.archiver import ARCHIVE_PATH
    tree: list[dict] = []
    if ARCHIVE_PATH.exists():
        for sd in sorted(ARCHIVE_PATH.iterdir()):
            if not sd.is_dir() or sd.name.startswith("."):
                continue
            authors: list[dict] = []
            direct = [f for f in sorted(sd.iterdir()) if f.is_file()]
            if direct:
                authors.append({"author": "", "files": [
                    {"name": f.name, "rel": str(f.relative_to(ARCHIVE_PATH)),
                     "md": f.suffix == ".md"} for f in direct]})
            for ad in sorted(sd.iterdir()):
                if not ad.is_dir():
                    continue
                files = [{"name": f.name,
                          "rel": str(f.relative_to(ARCHIVE_PATH)),
                          "md": f.suffix == ".md"}
                         for f in sorted(ad.iterdir()) if f.is_file()]
                if files:
                    authors.append({"author": ad.name, "files": files})
            if authors:
                tree.append({"stance": sd.name, "authors": authors})
    return {"tree": tree}


@router.get("/archive/file")
def archive_file(rel: str = Query(min_length=1)):
    """档案 md 正文（路径限制在 archive 目录内，防穿越）。"""
    from ingestion.archiver import ARCHIVE_PATH
    p = (ARCHIVE_PATH / rel).resolve()
    if not str(p).startswith(str(ARCHIVE_PATH.resolve())) or not p.is_file():
        raise HTTPException(404, "档案不存在")
    if p.suffix != ".md":
        raise HTTPException(422, "仅支持查看 md 档案；原件请用资源管理器打开")
    return {"rel": rel, "markdown": p.read_text(encoding="utf-8")}


class MetadataPatch(BaseModel):
    """0.1.3 B5：元数据字段级编辑（右键修改）。全部可空 = 只传要改的。"""
    title: str | None = None
    author: str | None = None
    year: int | None = None
    translator: str | None = None
    publisher: str | None = None
    edition: str | None = None
    original_title: str | None = None
    original_lang: str | None = None
    author_years: str | None = None
    school: str | None = None
    year_raw: str | None = None   # 0.1.5 I2：日期原文回显


@router.patch("/docs/{doc_id}/metadata")
def patch_metadata(doc_id: str, req: MetadataPatch):
    """元数据编辑：改过的字段记入 manual_fields，联网补充永不覆盖
    （决策10：手动 > 正文 > 文件名 > 网上）。"""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(422, "没有要修改的字段")
    if not get_db().update_document_fields(doc_id, fields):
        raise HTTPException(404, f"文档不存在: {doc_id}")
    return {"doc_id": doc_id, "updated": sorted(fields),
            "document": get_db().get_document(doc_id)}


@router.get("/docs/{doc_id}/preview")
def preview_doc(doc_id: str):
    """标准化 .md 预览（项目12 知识库面板消费）。"""
    doc = get_db().get_document(doc_id)
    if doc is None:
        raise HTTPException(404, f"文档不存在: {doc_id}")
    for p in config.STANCES_PATH.glob(f"*/{doc_id}.md"):
        return {"doc_id": doc_id, "markdown": p.read_text(encoding="utf-8")}
    # 无标准化 md（0.1.0 旧数据）→ 用摘要兜底
    return {"doc_id": doc_id,
            "markdown": f"# {doc.get('title') or doc_id}\n\n"
                        f"{doc.get('summary') or '（无摘要）'}"}


@router.get("/centers")
def list_centers():
    """中心点预设列表（项目10）：供前端下拉选择。"""
    return {"centers": [{"key": k, "label": v["label"], "note": v["note"]}
                        for k, v in get_skill_loader().centers().items()]}


@router.get("/search")
def search(q: str = Query(min_length=1), stance: str = "empirical",
           top_k: int = 5, mode: str = "hybrid",
           center: str | None = None):
    """带立场的检索（不生成反驳，仅返回候选块）；mode/center 见项目8/10。"""
    if mode not in ("keyword", "semantic", "hybrid", "smart"):
        raise HTTPException(422, f"未知搜索模式 {mode}")
    chain = get_engine().chain
    r = chain.run(q, stance, mode=mode, center=center)
    return {"query": q, "stance": stance, "mode": mode,
            "context_relevance": r["context_relevance"],
            "chunks": [{"chunk_id": c["chunk_id"], "doc_id": c["doc_id"],
                        "score": round(c["final_score"], 6),
                        "text": c["text"][:300]}
                       for c in r["chunks"][:top_k]],
            "excluded_docs": r["route"]["excluded"],
            "retrieval_ms": r["retrieval_ms"]}
