"""知识库打包接口（项目14）：导出/校验/导入合并，供桌面设置页与分享流程。

云备份说明：本版提供「备份到指定文件夹」（可指向任意网盘同步目录）；
S3 直传与自动定时备份记为后续债（见 PLAN 债务清单）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_db
from storage.lance_store import get_vector_store
from storage.packer import KnowledgePacker

router = APIRouter(prefix="/api/kb", tags=["kb-package"])


def _packer() -> KnowledgePacker:
    return KnowledgePacker(get_db(), get_vector_store())


class ExportRequest(BaseModel):
    path: str = Field(min_length=1, description="导出文件完整路径（.debkb）")
    doc_ids: list[str] | None = None
    include_vectors: bool = True


class ImportRequest(BaseModel):
    path: str = Field(min_length=1)
    on_duplicate: str = Field(default="skip", pattern="^(skip|replace)$")


@router.post("/export")
def export_kb(req: ExportRequest):
    try:
        return _packer().pack(req.path, req.doc_ids, req.include_vectors)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/verify")
def verify_kb(req: ImportRequest):
    if not Path(req.path).exists():
        raise HTTPException(404, f"文件不存在: {req.path}")
    try:
        return KnowledgePacker.verify(req.path)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/import")
def import_kb(req: ImportRequest):
    if not Path(req.path).exists():
        raise HTTPException(404, f"文件不存在: {req.path}")
    try:
        return _packer().import_package(req.path, req.on_duplicate)
    except ValueError as e:
        raise HTTPException(422, str(e))
