"""素材篮 + 回应历史（项目18/19）：双面布局的跨面弹药通道与输出台账。

素材篮与回应历史都跟知识库走（引擎侧 SQLite），但都不进分享包
（kb_package 白名单制，无需额外排除）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_engine

router = APIRouter(prefix="/api", tags=["workspace"])


def _db():
    return get_engine().db


# ---------- 素材组（0.1.4 批 4） ----------
class GroupAdd(BaseModel):
    name: str = Field(min_length=1, max_length=40)


@router.get("/groups")
def group_list():
    return {"groups": _db().group_list()}


@router.post("/groups")
def group_add(req: GroupAdd):
    try:
        return _db().group_add(req.name)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.patch("/groups/{group_id}")
def group_rename(group_id: int, req: GroupAdd):
    try:
        n = _db().group_rename(group_id, req.name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not n:
        raise HTTPException(404, "组不存在")
    return {"ok": True}


@router.delete("/groups/{group_id}")
def group_delete(group_id: int):
    try:
        return _db().group_delete(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))


# ---------- 素材篮 ----------
class BasketAdd(BaseModel):
    item_type: str = Field(pattern="^(chunk|arg_unit|document)$")
    ref_id: str = Field(min_length=1)
    excerpt: str = Field(min_length=1, max_length=2000)
    source: str = ""
    group_id: int | None = None    # 缺省 = 公共素材组


@router.get("/basket")
def basket_list():
    items = _db().basket_list()
    return {"items": items, "count": len(items), "cap": _db().BASKET_CAP}


@router.post("/basket")
def basket_add(req: BasketAdd):
    try:
        r = _db().basket_add(req.item_type, req.ref_id, req.excerpt,
                             req.source, group_id=req.group_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return r


@router.delete("/basket")
def basket_clear():
    return {"removed": _db().basket_remove()}


@router.delete("/basket/{item_id}")
def basket_remove(item_id: int):
    n = _db().basket_remove(item_id)
    if not n:
        raise HTTPException(404, "素材不存在")
    return {"removed": n}


# ---------- 回应历史 ----------
class StarPatch(BaseModel):
    starred: bool


class ResponseAdd(BaseModel):
    intent: str = "answer"
    stance: str = ""
    input_text: str
    output_text: str
    provider: str = ""


@router.post("/responses")
def response_add(req: ResponseAdd):
    """0.1.8 N1：前端主动存历史（对辩等编排类输出）。"""
    rid = _db().response_add(req.intent, req.input_text, req.output_text,
                             "[]", req.provider, req.stance)
    return {"id": rid}


@router.get("/responses")
def responses(limit: int = 100):
    return {"items": _db().response_list(min(limit, 500))}


@router.patch("/responses/{resp_id}/star")
def response_star(resp_id: int, req: StarPatch):
    if not _db().response_star(resp_id, req.starred):
        raise HTTPException(404, "记录不存在")
    return {"ok": True}


@router.delete("/responses/{resp_id}")
def response_delete(resp_id: int):
    if not _db().response_delete(resp_id):
        raise HTTPException(404, "记录不存在")
    return {"ok": True}
