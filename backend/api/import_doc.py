"""导入接口：POST /api/import（预览）→ POST /api/import/confirm（确认入库）。

0.1.1 新增：预览响应带 duplicate 查重字段；confirm 支持 on_duplicate；
批量导入端点 + 进度查询端点（供桌面导入 UI 进度条）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_indexer
from ingestion.indexer import PENDING, collect_sources

router = APIRouter(prefix="/api", tags=["import"])

# 批量导入状态（单机单队列，供进度端点轮询）
BATCH_STATE: dict = {"running": False, "items": []}


class ImportRequest(BaseModel):
    source: str = Field(min_length=1, description="文件路径或 URL")
    summary_strategy: str = Field(default="auto",
                                  pattern="^(auto|map_reduce|refine|full_context)$")


class ConfirmRequest(BaseModel):
    doc_id: str
    stance: str = Field(min_length=1)
    on_duplicate: str = Field(default="keep-both",
                              pattern="^(skip|replace|keep-both)$")


class BatchRequest(BaseModel):
    sources: list[str] = Field(min_length=1)
    stance: str | None = None
    on_duplicate: str = Field(default="skip",
                              pattern="^(skip|replace|keep-both)$")
    summary_strategy: str = Field(default="auto",
                                  pattern="^(auto|map_reduce|refine|full_context)$")


@router.post("/import")
def import_preview(req: ImportRequest):
    """Stage 0-6：解析/摘要/坐标/立场推断，返回预览等待确认。"""
    if Path(req.source).is_dir():
        raise HTTPException(422, "来源是文件夹，请用批量导入接口 /api/import/batch")
    try:
        pv = get_indexer().preview(req.source, strategy=req.summary_strategy)
    except FileNotFoundError:
        raise HTTPException(404, f"文件不存在: {req.source}")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return pv.to_dict()


@router.post("/import/confirm")
def import_confirm(req: ConfirmRequest):
    """Stage 7-10：用户确认立场后完成入库（含查重处置）。"""
    pv = PENDING.get(req.doc_id)
    if pv is None:
        raise HTTPException(404,
                            f"无待确认的导入 {req.doc_id}（预览可能已过期，请重新导入）")
    idx = get_indexer()
    if pv.duplicate:
        if req.on_duplicate == "replace":
            idx.delete_document(pv.duplicate["existing_doc_id"])
            if pv.duplicate["type"] == "exact":
                pv = idx.preview(pv.source)   # exact 预览短路过，补跑完整分析
        elif pv.duplicate["type"] == "exact":
            raise HTTPException(409, "完全重复文档，on_duplicate=replace 才能重新入库")
    return idx.confirm(pv, req.stance)


def _run_batch(req: BatchRequest) -> None:
    idx = get_indexer()
    for item in BATCH_STATE["items"]:
        if item["status"] != "pending":
            continue   # 不支持格式已标 skipped
        item["status"] = "running"
        try:
            r = idx.import_document(item["source"], stance=req.stance,
                                    on_duplicate=req.on_duplicate,
                                    strategy=req.summary_strategy)
            if r.get("skipped"):
                item["status"], item["detail"] = "skipped", r["skipped"]
            else:
                item["status"], item["detail"] = "success", r["doc_id"]
        except Exception as exc:   # 逐文件隔离：单个失败不中断队列
            item["status"], item["detail"] = "failed", str(exc)
    BATCH_STATE["running"] = False


@router.post("/import/batch")
def import_batch(req: BatchRequest, background_tasks: BackgroundTasks):
    """批量导入（后台执行）：文件夹自动展开；用 GET /api/import/progress 轮询进度。"""
    if BATCH_STATE["running"]:
        raise HTTPException(409, "已有批量导入进行中")
    sources, unsupported = collect_sources(req.sources)
    if not sources and not unsupported:
        raise HTTPException(422, "没有可导入的文件")
    BATCH_STATE["items"] = (
        [{"source": s, "status": "pending", "detail": None} for s in sources]
        + [{"source": s, "status": "skipped", "detail": "不支持的格式"}
           for s in unsupported])
    BATCH_STATE["running"] = True
    background_tasks.add_task(_run_batch, req)
    return {"accepted": len(sources), "unsupported": len(unsupported)}


@router.get("/import/progress")
def import_progress():
    """批量导入进度：队列各文件状态（pending/running/success/skipped/failed）。"""
    items = BATCH_STATE["items"]
    done = sum(1 for i in items
               if i["status"] in ("success", "skipped", "failed"))
    return {"running": BATCH_STATE["running"], "total": len(items),
            "done": done, "items": items}


@router.delete("/import/{doc_id}")
def delete_doc(doc_id: str):
    """级联删除：SQLite 四表 + FTS + 向量库 + meta.json。"""
    counts = get_indexer().delete_document(doc_id)
    if counts.get("documents", 0) == 0:
        raise HTTPException(404, f"文档不存在: {doc_id}")
    return {"doc_id": doc_id, "deleted": counts}
