"""分析接口（项目15/16/17）：分歧地图/跨页对比/图谱/溯源/综合报告。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_db
from engine.alignment import AlignmentEngine, graph_data
from engine.report import ReportEngine
from storage.lance_store import get_vector_store

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _align() -> AlignmentEngine:
    return AlignmentEngine(get_db())


@router.get("/divergence")
def divergence(stance: str):
    """内部分歧地图：同立场内「论题相近、结论对立」配对。"""
    return _align().divergence_map(stance)


class CompareRequest(BaseModel):
    doc_a: str | None = None
    doc_b: str | None = None
    text_a: str | None = None
    text_b: str | None = None


@router.post("/compare")
def compare(req: CompareRequest):
    """跨页对比：库内两文档或粘贴两段文本 → 分歧表。"""
    if req.doc_a and req.doc_b:
        return _align().compare_docs(req.doc_a, req.doc_b)
    if req.text_a and req.text_b:
        return _align().compare_texts(req.text_a, req.text_b)
    raise HTTPException(422, "需要 doc_a+doc_b 或 text_a+text_b")


class BuildRelationsRequest(BaseModel):
    doc_ids: list[str] | None = None


@router.post("/relations/build")
def build_relations(req: BuildRelationsRequest):
    """对齐配对判定并写回 arg_units 关系边（图谱数据源）。"""
    return _align().build_relations(req.doc_ids)


@router.get("/graph")
def graph(stance: str | None = None, doc_id: str | None = None):
    """图谱数据：节点=论证单元，边=support/attack/refine。"""
    return graph_data(get_db(), stance, doc_id)


class UnitPatch(BaseModel):
    claim: str | None = None
    evidence: str | None = None
    thinker: str | None = None
    school: str | None = None
    relation: str | None = Field(
        default=None,
        pattern="^(support|attack|refine|evolve|analogy|oppose)$")
    target_unit_id: str | None = None


@router.patch("/units/{arg_id}")
def edit_unit(arg_id: str, req: UnitPatch):
    """图谱人工纠错：编辑论证单元（白名单字段）。"""
    n = get_db().update_arg_unit(
        arg_id, {k: v for k, v in req.model_dump().items() if v is not None})
    if n == 0:
        raise HTTPException(404, f"论证单元不存在或无可改字段: {arg_id}")
    return {"arg_id": arg_id, "updated": n}


@router.delete("/units/{arg_id}")
def delete_unit(arg_id: str):
    n = get_db().delete_arg_unit(arg_id)
    if n == 0:
        raise HTTPException(404, f"论证单元不存在: {arg_id}")
    return {"arg_id": arg_id, "deleted": n}


class TraceRequest(BaseModel):
    claim: str = Field(min_length=2, max_length=1000)
    stance: str | None = None
    year_from: int | None = None
    year_to: int | None = None


@router.post("/trace")
def trace(req: TraceRequest):
    """论点溯源：库内对齐按年代排序（有据）+ 模型推测段（异色区分）。"""
    return _align().trace(req.claim, stance=req.stance,
                          year_from=req.year_from, year_to=req.year_to)


@router.get("/chain")
def logic_chain(anchor: str, stance: str | None = None,
                max_nodes: int = 12):
    """逻辑链（项目14）：锚点 → 沿关系边提取论证主线（年代升序）。"""
    if len(anchor.strip()) < 2:
        raise HTTPException(422, "锚点至少 2 个字")
    return _align().logic_chain(anchor.strip(), stance,
                                max_nodes=min(max_nodes, 30))


class ReportRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=500)
    stances: list[str] | None = None


@router.post("/report/estimate")
def report_estimate(req: ReportRequest):
    return ReportEngine(get_db(), get_vector_store()).estimate(
        req.topic, req.stances)


@router.post("/report")
def report(req: ReportRequest):
    try:
        return ReportEngine(get_db(), get_vector_store()).generate(
            req.topic, req.stances)
    except ValueError as e:
        raise HTTPException(422, str(e))
