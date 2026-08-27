"""0.1.7 项 3：已入库文档「重新提取坐标」后台任务。

复用 hotfix5 线程模式（ollama_adapter）：真正干活的是后台 daemon 线程，
HTTP 流只转发进度——断流不中断任务，再次调用=接入进行中任务续看。
逐文档：清三种断点标记（章节 summarized + __doc__/coordinates +
__doc__/doc_summary）→ arg_units 先删后插（防尾号残留）→ 重跑章节
summarize + 全书坐标（分类保持原 stance 不重判）→ provenance 读-改-写
保留 source/classification 子键 → 清指向旧单元的悬空边。
断点粒度：文档级 reextract 标记（pending→cleared→done）+ 章节级
summarized 标记，中断后重点一次从断点续做。
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import new_trace_id

router = APIRouter(prefix="/api", tags=["reextract"])

_LOCK = threading.Lock()
_TASK: dict = {"seq": 0, "event": None, "running": False}


def _emit(obj: dict) -> None:
    _TASK["event"] = obj
    _TASK["seq"] += 1


def _clear_marks(idx, doc_id: str, n_chapters: int) -> None:
    """清三种断点标记 + 缓存对应键（原「有效 0」时代的产物全部作废）。"""
    for i in range(n_chapters):
        idx._mark(doc_id, f"{doc_id}_ch{i:03d}", "summarized", "redo")
    idx._mark(doc_id, "__doc__", "doc_summary", "redo")
    idx._mark(doc_id, "__doc__", "coordinates", "redo")
    p = idx._summary_cache_path(doc_id)
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        for i in range(n_chapters):
            data.pop(f"{doc_id}_ch{i:03d}", None)
        data.pop("__doc_summary__", None)
        data.pop("__coordinates__", None)
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _reextract_one(idx, doc: dict, base: int, total: int) -> None:
    from ingestion.classifier import extract_coordinates
    from ingestion.summarizer import (summarize_chapter_with_args,
                                      summarize_document)
    db = idx.db
    doc_id = doc["doc_id"]
    title = doc.get("title") or doc_id
    chunks = [dict(r) for r in db.conn.execute(
        "SELECT c.chunk_id, c.text, c.chapter_id, ch.title AS chapter_title "
        "FROM chunks c LEFT JOIN chapters ch ON ch.chapter_id = c.chapter_id "
        "WHERE c.doc_id = ? ORDER BY c.chunk_id", (doc_id,)).fetchall()]
    if not chunks:
        idx._mark(doc_id, "__doc__", "reextract", "done")
        return
    if db.get_progress(doc_id, "__doc__", "reextract") != "cleared":
        _clear_marks(idx, doc_id, len(chunks))
        idx._mark(doc_id, "__doc__", "reextract", "cleared")

    trace_id = new_trace_id()
    summaries: list[str] = []
    units_by_ch: list[list[dict]] = []
    for i, ch in enumerate(chunks):
        chap_id = f"{doc_id}_ch{i:03d}"
        cached = idx._load_cached_summary(doc_id, chap_id)
        if idx._done(doc_id, chap_id, "summarized") and isinstance(cached, dict):
            summaries.append(cached.get("summary", ""))
            units_by_ch.append(cached.get("arg_units", []))
            continue
        _emit({"percent": round((base + i / len(chunks)) * 100 / total, 1),
               "status": f"《{title}》章节 {i + 1}/{len(chunks)} 摘要…",
               "doc_id": doc_id})
        s, units = summarize_chapter_with_args(
            ch["chapter_title"] or "", ch["text"], router=idx.router,
            trace_id=trace_id, doc_type=doc.get("source_type") or "")
        summaries.append(s)
        units_by_ch.append(units)
        idx._cache_summary(doc_id, chap_id, {"summary": s, "arg_units": units})
        idx._mark(doc_id, chap_id, "summarized")
        db.conn.execute("UPDATE chapters SET summary=? WHERE chapter_id=?",
                        (s, ch["chapter_id"]))
        db.conn.commit()

    _emit({"percent": round((base + 0.9) * 100 / total, 1),
           "status": f"《{title}》全书总结+22 轴坐标…", "doc_id": doc_id})
    doc_summary = summarize_document(summaries, router=idx.router,
                                     trace_id=trace_id) if summaries else ""
    coords = extract_coordinates(doc_summary or title,
                                 router=idx.router, trace_id=trace_id)
    if coords.get("extraction") == "offline":
        # 模型中途掉线：不能拿离线 null 覆盖，中断整任务（标记保留可续做）
        raise RuntimeError("本地模型不可用，坐标提取落了离线兜底")
    idx._cache_doc_extra(doc_id, "doc_summary", doc_summary)
    idx._mark(doc_id, "__doc__", "doc_summary")
    idx._cache_doc_extra(doc_id, "coordinates", coords)
    idx._mark(doc_id, "__doc__", "coordinates")

    # arg_units 先删后插（防旧尾号残留）；收集旧 id 清指向它们的悬空边
    old_ids = [r["arg_id"] for r in db.conn.execute(
        "SELECT arg_id FROM arg_units WHERE doc_id=?", (doc_id,))]
    db.conn.execute("DELETE FROM arg_units WHERE doc_id=?", (doc_id,))
    if old_ids:
        marks = ",".join("?" * len(old_ids))
        db.conn.execute(
            f"UPDATE arg_units SET relation=NULL, target_unit_id=NULL "
            f"WHERE target_unit_id IN ({marks})", old_ids)
    db.conn.commit()
    n_units = 0
    for i, units in enumerate(units_by_ch):
        cid = f"{doc_id}_c{i:04d}"
        for u in units:
            n_units += 1
            db.insert_arg_unit({
                "arg_id": f"{doc_id}_a{n_units:04d}",
                "chunk_id": cid, "doc_id": doc_id,
                "claim": u.get("claim"), "evidence": u.get("evidence"),
                "logic_pattern": u.get("logic_pattern"),
                "thinker": u.get("thinker") or None,
                "school": u.get("school") or None,
                "coordinates": coords})

    # provenance 读-改-写：只换 coordinates 子键，source/classification 保留
    prov = doc.get("provenance")
    prov = json.loads(prov) if isinstance(prov, str) else (prov or {})
    prov["coordinates"] = coords
    db.conn.execute(
        "UPDATE documents SET summary=?, provenance=?, "
        "updated_at=datetime('now') WHERE doc_id=?",
        (doc_summary, json.dumps(prov, ensure_ascii=False), doc_id))
    db.conn.commit()
    # meta.json 同步（stance 目录不动——分类不重判）
    for p in config.STANCES_PATH.glob(f"*/{doc_id}.meta.json"):
        m = json.loads(p.read_text(encoding="utf-8"))
        m["coordinates"] = coords
        m["summary"] = doc_summary
        p.write_text(json.dumps(m, ensure_ascii=False, indent=2),
                     encoding="utf-8")
    idx._mark(doc_id, "__doc__", "reextract", "done")


def _worker() -> None:
    from ingestion.indexer import Indexer
    idx = Indexer()   # 线程内自建实例（sqlite 连接 check_same_thread=False）
    db = idx.db
    try:
        docs = db.list_documents()
        # 断点：上轮 pending/cleared 的文档=未完成，只补这些；否则全量新一轮
        state = {d["doc_id"]: db.get_progress(d["doc_id"], "__doc__", "reextract")
                 for d in docs}
        resume = [d for d in docs if state[d["doc_id"]] in ("pending", "cleared")]
        todo = resume or docs
        if not resume:
            for d in docs:
                idx._mark(d["doc_id"], "__doc__", "reextract", "pending")
        total = len(todo) or 1
        for n, d in enumerate(todo):
            _emit({"percent": round(n * 100 / total, 1),
                   "status": f"《{d.get('title') or d['doc_id']}》重提取中…",
                   "doc_id": d["doc_id"]})
            _reextract_one(idx, d, n, total)
        # 0.1.9 E1：重提取清边同时置空 relations_at，使这些文档重新计入「更新新增」
        db.clear_relations_at([d["doc_id"] for d in todo])
        _emit({"done": True, "ok": True,
               "detail": f"重提取完成 {len(todo)} 本；关系边已清理，"
                         f"可到图谱点「更新新增」重建连线"})
    except Exception as e:  # noqa: BLE001 统一收尾报告，标记保留供续做
        _emit({"done": True, "ok": False,
               "detail": f"重提取中断：{type(e).__name__} {str(e)[:150]}"
                         f"（再点一次从断点继续）"})
    finally:
        _TASK["running"] = False


@router.post("/analysis/coords/reextract")
def coords_reextract():
    """启动/接入重提取任务（NDJSON 进度流）。模型不可用时直接拒绝，
    避免拿离线 null 把存量坐标洗掉。"""
    from models.model_router import get_router

    def gen():
        with _LOCK:
            if not _TASK["running"]:
                if not any(get_router().health().values()):
                    yield json.dumps(
                        {"done": True, "ok": False,
                         "detail": "本地模型未运行且无可用云端：先到设置·本地"
                                   "模型启动 Ollama（或配置服务商 Key）再重提取"},
                        ensure_ascii=False) + "\n"
                    return
                _TASK["running"] = True
                _emit({"status": "任务启动（后台执行，关闭页面不中断）…",
                       "percent": 0})
                threading.Thread(target=_worker, daemon=True).start()
            else:
                _emit({"status": "已有任务进行中，接入实时进度…"})
        seen = 0
        while True:
            if _TASK["seq"] != seen:
                seen = _TASK["seq"]
                evt = _TASK["event"]
                if evt:
                    yield json.dumps(evt, ensure_ascii=False) + "\n"
                    if evt.get("done"):
                        return
            time.sleep(0.25)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.get("/analysis/coords/reextract/status")
def coords_reextract_status():
    """轮询：任务是否在跑 + 最新进度（刷新页面后恢复显示用）。"""
    return {"running": _TASK["running"], "progress": _TASK["event"]}
