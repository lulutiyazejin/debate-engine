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
import config
from api.deps import get_db, get_indexer
from ingestion.indexer import PENDING, collect_sources
from ingestion.web_enrich import enrich, enrichment_enabled

router = APIRouter(prefix="/api", tags=["import"])

# 批量导入状态（单机单队列，供进度端点轮询；0.1.5 I1 加 cancel 标志）
BATCH_STATE: dict = {"running": False, "items": [], "cancel": False}


class ImportRequest(BaseModel):
    source: str = Field(min_length=1, description="文件路径或 URL")
    summary_strategy: str = Field(default="auto",
                                  pattern="^(auto|map_reduce|refine|full_context)$")


class ConfirmRequest(BaseModel):
    doc_id: str
    stance: str = Field(min_length=1)
    on_duplicate: str = Field(default="keep-both",
                              pattern="^(skip|replace|keep-both)$")
    # 0.1.4 批 6：归档三选（缺省读 settings archive_policy）+「记住选择」
    archive: str | None = Field(default=None, pattern="^(copy|move|none)$")
    remember: bool = False
    # 0.1.5 F5：超墙三选——map_reduce=分章（预览已跑不重跑）；
    # full=换大窗/仍投喂（confirm 时重跑整书总结）
    over_window: str | None = Field(default=None,
                                    pattern="^(map_reduce|full)$")
    remember_over_window: bool = False


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
    """Stage 7-10：用户确认立场后完成入库（含查重处置 + 归档三选）。"""
    if req.remember and req.archive:
        config.save_settings({"archive_policy": req.archive})
    if req.remember_over_window and req.over_window:
        config.save_settings({"over_window_policy": req.over_window})
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
    if req.over_window == "full":
        # F5：换大窗/仍投喂——整书重跑总结（路由链自然落云端大窗）
        from ingestion.summarizer import summarize_full_context
        try:
            new_sum = summarize_full_context(pv.parsed.full_text,
                                             trace_id=pv.trace_id)
            if new_sum:
                pv.doc_summary = new_sum
        except Exception:   # 重跑失败保留预览摘要，不阻断入库
            pass
    return idx.confirm(pv, req.stance, archive=req.archive)


def _run_batch(req: BatchRequest) -> None:
    idx = get_indexer()
    for item in BATCH_STATE["items"]:
        if BATCH_STATE.get("cancel"):   # 0.1.5 I1：取消后剩余 pending 已标「已取消」
            break
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
                # 0.1.8 M2：批量入库写 pending 待审（单篇有确认屏，批量进待审队列；
                # pending 不参与检索/图谱/脉络/回应素材，馆藏灰显+待审徽章）
                try:
                    get_db().set_review_status(r["doc_id"], "pending")
                except Exception:
                    pass
                # 0.1.5 H1：批量静默降级，报告逐本标实际落点
                try:
                    from ingestion.summarizer import summary_window
                    item["via"] = summary_window()[1]
                except Exception:
                    item["via"] = ""
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
    BATCH_STATE["cancel"] = False
    background_tasks.add_task(_run_batch, req)
    return {"accepted": len(sources), "unsupported": len(unsupported)}


@router.post("/import/cancel")
def import_cancel():
    """0.1.5 I1：取消批量导入——pending 项标「已取消」，当前正在跑的项跑完即止。"""
    if not BATCH_STATE.get("running"):
        return {"cancelled": 0}
    BATCH_STATE["cancel"] = True
    n = 0
    for item in BATCH_STATE["items"]:
        if item["status"] == "pending":
            item["status"], item["detail"] = "cancelled", "已取消"
            n += 1
    return {"cancelled": n}


@router.get("/import/progress")
def import_progress():
    """批量导入进度：队列各文件状态（pending/running/success/skipped/failed）。"""
    items = BATCH_STATE["items"]
    done = sum(1 for i in items
               if i["status"] in ("success", "skipped", "failed", "cancelled"))
    return {"running": BATCH_STATE["running"], "total": len(items),
            "done": done, "items": items}


@router.delete("/import/{doc_id}")
def delete_doc(doc_id: str, archive: str = "keep"):
    """级联删除：SQLite 四表 + FTS + 向量库 + meta.json；
    archive=delete 才连档案库一起删（默认保留，0.1.4 决策 6）。"""
    counts = get_indexer().delete_document(doc_id,
                                           delete_archive=archive == "delete")
    if counts.get("documents", 0) == 0:
        raise HTTPException(404, f"文档不存在: {doc_id}")
    return {"doc_id": doc_id, "deleted": counts}


# ---------- 0.1.4 批 6（决策 6）：归档策略 ----------

class PolicyPatch(BaseModel):
    policy: str = Field(pattern="^(ask|copy|move|none)$")


@router.get("/import/archive-policy")
def get_archive_policy():
    """ask=每次确认屏三选；copy/move/none=记住的默认策略。"""
    return {"policy": config.load_settings().get("archive_policy") or "ask"}


@router.patch("/import/archive-policy")
def set_archive_policy(req: PolicyPatch):
    config.save_settings({"archive_policy": req.policy})
    return {"policy": req.policy}
