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
    return {"documents": db.list_documents(stance), "stats": db.stats(),
            "pending": len(db.pending_doc_ids())}


# ---------- 0.1.8 M2：批量导入待审队列 ----------

@router.post("/docs/{doc_id}/approve")
def approve_doc(doc_id: str):
    """单篇通过审核：pending → approved，恢复参与检索/图谱/素材。"""
    if not get_db().set_review_status(doc_id, "approved"):
        raise HTTPException(404, f"文档不存在: {doc_id}")
    return {"doc_id": doc_id, "review_status": "approved"}


@router.post("/approve-all")
def approve_all():
    """一键清空待审队列。"""
    n = get_db().approve_all()
    return {"approved": n}


# ---------- 0.1.8 N3：阅读器高亮批注 ----------

class HighlightReq(BaseModel):
    quote: str = Field(min_length=1, max_length=5000)
    prefix: str = ""
    suffix: str = ""
    color: str = "yellow"
    note: str = ""


@router.get("/docs/{doc_id}/highlights")
def list_highlights(doc_id: str):
    return {"highlights": get_db().highlight_list(doc_id)}


@router.post("/docs/{doc_id}/highlights")
def add_highlight(doc_id: str, req: HighlightReq):
    hl_id = get_db().highlight_add(doc_id, req.quote, req.prefix[-32:],
                                   req.suffix[:32], req.color, req.note)
    return {"id": hl_id}


@router.delete("/highlights/{hl_id}")
def del_highlight(hl_id: int):
    if get_db().highlight_delete(hl_id) == 0:
        raise HTTPException(404, "高亮不存在")
    return {"deleted": True}


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
    # 0.1.9 D1：年份校验改调共用 sane_year（与导入解析同语义），同时兼容完整日期
    if "year" in fields:
        from lib.years import sane_year
        yi, yr = sane_year(fields["year"])
        if yi is None:
            raise HTTPException(422, "年份超出合理范围（-3000 ~ 2600）；区间写法请只填起始年")
        fields["year"] = yi
        fields.setdefault("year_raw", yr)   # 前端未传 year_raw 时用归一化原文兜底
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


# ---------- 0.1.8 M6：文档合并（分期文章归一档，走 BgTask 断流不中断） ----------

class MergeRequest(BaseModel):
    doc_ids: list[str] = Field(min_length=2)   # 有序（章节并入顺序）
    target_id: str = Field(min_length=1)


def _merge_worker_factory(doc_ids: list[str], target_id: str):
    def _worker(task):
        from api.deps import get_db as _get_db, get_indexer as _get_indexer
        db = _get_db()
        vec = _get_indexer().vec
        c = db.conn
        sources = [d for d in doc_ids if d != target_id]
        task.emit({"status": f"开始合并 {len(sources)} 篇到目标文档", "percent": 2})
        # ① 章节/分块按序并入 target（chapter_num 接尾重排）
        row = c.execute("SELECT COALESCE(MAX(chapter_num),0) FROM chapters "
                        "WHERE doc_id=?", (target_id,)).fetchone()
        offset = int(row[0] or 0)
        done = 0
        for src in sources:
            if task.cancelled:
                task.emit({"done": True, "ok": False,
                           "detail": "已取消；已合并部分保留，建议检查库状态"})
                return
            n_ch = 0
            for ch in c.execute("SELECT chapter_id FROM chapters WHERE doc_id=? "
                                "ORDER BY chapter_num", (src,)).fetchall():
                n_ch += 1
                c.execute("UPDATE chapters SET doc_id=?, chapter_num=? "
                          "WHERE chapter_id=?",
                          (target_id, offset + n_ch, ch["chapter_id"]))
            offset += n_ch
            c.execute("UPDATE chunks SET doc_id=? WHERE doc_id=?",
                      (target_id, src))
            c.execute("UPDATE fts_index SET doc_id=? WHERE doc_id=?",
                      (target_id, src))
            c.execute("UPDATE arg_units SET doc_id=? WHERE doc_id=?",
                      (target_id, src))
            # ② 素材组 document 级引用改指 target（chunk/arg 引用 id 不变仍有效）
            c.execute("UPDATE OR IGNORE basket SET ref_id=? "
                      "WHERE item_type='document' AND ref_id=?",
                      (target_id, src))
            # 向量库 doc_id 迁移（向量不重算，chunk_id 不变）
            try:
                vec.rename_doc(src, target_id)
            except Exception:
                pass
            # ④ 删源 doc 库记录（硬删；子表已迁走，archive 原件全保留）
            c.execute("DELETE FROM ingestion_progress WHERE doc_id=?", (src,))
            c.execute("DELETE FROM highlights WHERE doc_id=?", (src,))
            c.execute("DELETE FROM documents WHERE doc_id=?", (src,))
            done += 1
            task.emit({"status": f"已并入 {done}/{len(sources)} 篇",
                       "percent": 5 + int(done * 60 / len(sources))})
        c.commit()
        # ⑤ target 重跑整书摘要（LLM，失败不阻塞）
        task.emit({"status": "重新生成合并后整书摘要…", "percent": 70})
        try:
            from ingestion.summarizer import summarize_document
            rows = c.execute("SELECT summary FROM chapters WHERE doc_id=? "
                             "ORDER BY chapter_num", (target_id,)).fetchall()
            summaries = [r["summary"] for r in rows if r["summary"]]
            if summaries:
                new_sum = summarize_document(summaries).strip()
                if new_sum and not new_sum.startswith("（离线"):
                    c.execute("UPDATE documents SET summary=? WHERE doc_id=?",
                              (new_sum, target_id))
                    c.commit()
        except Exception as e:  # noqa: BLE001 摘要失败不影响合并主链路
            task.emit({"status": f"摘要重生成跳过（{e}）", "percent": 85})
        try:
            _get_indexer()._update_index()
        except Exception:
            pass
        task.emit({"done": True, "ok": True,
                   "detail": f"合并完成：{len(sources)} 篇已并入目标文档。"
                             "坐标可到馆藏点「重新提取坐标」更新；"
                             "关系边可到图谱点「生成关系」重建"})
    return _worker


@router.post("/merge")
def merge_docs(req: MergeRequest, last_seq: int = 0):
    """0.1.8 M6：多文档合并。NDJSON 进度流（BgTask，断流不中断）。"""
    from fastapi.responses import StreamingResponse
    from tasks import BgTask
    db = get_db()
    if req.target_id not in req.doc_ids:
        raise HTTPException(422, "target_id 必须在 doc_ids 内")
    for d in req.doc_ids:
        if db.get_document(d) is None:
            raise HTTPException(404, f"文档不存在: {d}")
    task = BgTask.get_or_start(
        "merge-docs", _merge_worker_factory(req.doc_ids, req.target_id))
    return StreamingResponse(task.follow(last_seq),
                             media_type="application/x-ndjson")
