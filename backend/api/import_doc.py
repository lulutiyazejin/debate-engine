"""导入接口：POST /api/import（预览）→ POST /api/import/confirm（确认入库）。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_indexer
from ingestion.indexer import PENDING

router = APIRouter(prefix="/api", tags=["import"])


class ImportRequest(BaseModel):
    source: str = Field(min_length=1, description="文件路径或 URL")


class ConfirmRequest(BaseModel):
    doc_id: str
    stance: str = Field(min_length=1)


@router.post("/import")
def import_preview(req: ImportRequest):
    """Stage 0-6：解析/摘要/坐标/立场推断，返回预览等待确认。"""
    try:
        pv = get_indexer().preview(req.source)
    except FileNotFoundError:
        raise HTTPException(404, f"文件不存在: {req.source}")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return pv.to_dict()


@router.post("/import/confirm")
def import_confirm(req: ConfirmRequest):
    """Stage 7-10：用户确认立场后完成入库。"""
    pv = PENDING.get(req.doc_id)
    if pv is None:
        raise HTTPException(404,
                            f"无待确认的导入 {req.doc_id}（预览可能已过期，请重新导入）")
    return get_indexer().confirm(pv, req.stance)


@router.delete("/import/{doc_id}")
def delete_doc(doc_id: str):
    """级联删除：SQLite 四表 + FTS + 向量库 + meta.json。"""
    counts = get_indexer().delete_document(doc_id)
    if counts.get("documents", 0) == 0:
        raise HTTPException(404, f"文档不存在: {doc_id}")
    return {"doc_id": doc_id, "deleted": counts}
