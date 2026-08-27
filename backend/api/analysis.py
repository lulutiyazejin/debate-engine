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
    mode: str | None = None  # 0.1.9 E1: full|incremental


@router.post("/relations/build")
def build_relations(req: BuildRelationsRequest):
    """对齐配对判定并写回 arg_units 关系边（图谱数据源）。
    0.1.9 E1: mode=None(全库)/full(全量重建)/incremental(新×全库交叉)。"""
    return _align().build_relations(req.doc_ids, mode=req.mode)


@router.get("/relations/pending_count")
def relations_pending_count():
    """0.1.9 E1：待更新（relations_at IS NULL）文档数，供前端「更新新增（N）」按钮。"""
    return {"count": get_db().count_relations_pending()}


@router.get("/coords/pending_count")
def coords_pending_count():
    """0.1.9 L3：坐标疑似未提取（缺失或全 0）文档数，供馆藏工具条黄色角标。
    与前端 isSuspiciousZero 同义：提取完成（真坐标）后计数归零 → 角标消失。"""
    db = get_db()
    rows = db.conn.execute(
        "SELECT provenance FROM documents WHERE deleted_at IS NULL").fetchall()
    n = 0
    for r in rows:
        c = _coords_of(r["provenance"])
        if not c or all(v == 0 for v in c.values()):
            n += 1
    return {"count": n}


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


@router.get("/chain/procon")
def chain_procon(ids: str):
    """0.1.8 N2：主线节点正反子论点——查库内 relation 指向节点的单元，
    支持/细化/演进→pro 列，攻击/同题对立→con 列（Kialo 式）。"""
    id_list = [i for i in ids.split(",") if i.strip()][:30]
    if not id_list:
        return {"procon": {}}
    db = get_db()
    ph = ",".join("?" * len(id_list))
    rows = db.conn.execute(
        f"SELECT u.arg_id, u.claim, u.relation, u.target_unit_id, u.doc_id, "
        f"       d.title FROM arg_units u "
        f"JOIN documents d ON d.doc_id = u.doc_id AND d.deleted_at IS NULL "
        f"WHERE u.target_unit_id IN ({ph}) AND u.relation IS NOT NULL",
        id_list).fetchall()
    out: dict[str, dict] = {i: {"pro": [], "con": []} for i in id_list}
    _PRO = {"support", "refine", "evolve"}
    _CON = {"attack", "oppose"}
    for r in rows:
        side = "pro" if r["relation"] in _PRO else (
            "con" if r["relation"] in _CON else None)
        if side is None:
            continue
        out[r["target_unit_id"]][side].append({
            "id": r["arg_id"], "claim": r["claim"], "doc_id": r["doc_id"],
            "doc_title": r["title"], "relation": r["relation"]})
    return {"procon": out}


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


# ---------- 0.1.5 批 5：可视化数据源（J1/J3/J4） ----------
import json as _json

_BINS = [(-5, -3), (-3, -1), (-1, 1), (1, 3), (3, 5)]   # J3 轴区间分箱（五档）


def _coords_of(raw: str | None) -> dict:
    """provenance/coordinates JSON → 纯数值轴字典（过滤 low_confidence 标记键）。"""
    try:
        d = _json.loads(raw or "{}")
    except _json.JSONDecodeError:
        return {}
    if "coordinates" in d and isinstance(d["coordinates"], dict):
        d = d["coordinates"]
    return {k: float(v) for k, v in d.items() if isinstance(v, (int, float))}


@router.get("/coords")
def coords():
    """J1/J4 数据源：文档 22 轴坐标点 + 立场画像（轴均值）。"""
    db = get_db()
    rows = db.conn.execute(
        "SELECT doc_id,title,author,stance,provenance FROM documents "
        "WHERE deleted_at IS NULL").fetchall()
    # 0.1.8 M2：待审文档不参与可视化分布
    _pending = set(db.pending_doc_ids())
    if _pending:
        rows = [r for r in rows if r["doc_id"] not in _pending]
    docs = []
    prof: dict[str, dict] = {}   # stance -> {axis: [sum, n]}
    for r in rows:
        c = _coords_of(r["provenance"])
        if not c:
            continue
        docs.append({"doc_id": r["doc_id"], "title": r["title"],
                     "author": r["author"], "stance": r["stance"] or "",
                     "coords": c})
        p = prof.setdefault(r["stance"] or "", {})
        for k, v in c.items():
            s = p.setdefault(k, [0.0, 0])
            s[0] += v
            s[1] += 1
    profiles = [{"stance": s, "count": max((n for _, n in p.values()), default=0),
                 "avg": {k: round(v / n, 2) for k, (v, n) in p.items() if n}}
                for s, p in prof.items()]
    return {"docs": docs, "profiles": profiles}


@router.get("/crosstab")
def crosstab(axis: str, metric: str = "count", metric_axis: str | None = None):
    """J3 交叉透视：行=立场 × 列=axis 五档分箱 × 值=单元数/均值（metric_axis）。"""
    db = get_db()
    rows = db.conn.execute(
        "SELECT a.coordinates, d.stance FROM arg_units a "
        "JOIN documents d ON d.doc_id=a.doc_id WHERE d.deleted_at IS NULL"
    ).fetchall()
    # cells[stance][bin] = [count, metric_sum, metric_n]
    cells: dict[str, list[list[float]]] = {}
    for r in rows:
        c = _coords_of(r["coordinates"])
        if axis not in c:
            continue
        v = c[axis]
        bi = next((i for i, (lo, hi) in enumerate(_BINS)
                   if (lo <= v < hi) or (i == len(_BINS) - 1 and v == hi)), None)
        if bi is None:
            continue
        row = cells.setdefault(r["stance"] or "", [[0, 0.0, 0] for _ in _BINS])
        row[bi][0] += 1
        if metric == "avg" and metric_axis and metric_axis in c:
            row[bi][1] += c[metric_axis]
            row[bi][2] += 1
    out = []
    for s, row in cells.items():
        vals = ([cnt for cnt, _, _ in row] if metric == "count"
                else [round(sm / n, 2) if n else None for _, sm, n in row])
        out.append({"stance": s, "cells": vals,
                    "total": sum(cnt for cnt, _, _ in row)})
    out.sort(key=lambda x: -x["total"])
    return {"bins": [f"{lo}〜{hi}" for lo, hi in _BINS], "rows": out}


@router.get("/heatmap")
def heatmap(doc_id: str):
    """J4 热力：章节 × 轴 → 单元坐标强度均值（|coord| 均值，未涉及=null）。"""
    db = get_db()
    chs = db.conn.execute(
        "SELECT chapter_id,title,chapter_num FROM chapters WHERE doc_id=? "
        "ORDER BY chapter_num", (doc_id,)).fetchall()
    units = db.conn.execute(
        "SELECT a.coordinates, c.chapter_id FROM arg_units a "
        "JOIN chunks c ON c.chunk_id=a.chunk_id WHERE a.doc_id=?",
        (doc_id,)).fetchall()
    from ingestion.classifier import AXES
    acc: dict[str, dict[str, list[float]]] = {}   # chapter -> axis -> [sum, n]
    for u in units:
        c = _coords_of(u["coordinates"])
        ch = u["chapter_id"] or ""
        for k, v in c.items():
            s = acc.setdefault(ch, {}).setdefault(k, [0.0, 0])
            s[0] += abs(v)
            s[1] += 1
    chapters, grid = [], []
    for ch in chs:
        chapters.append(ch["title"] or f"第 {ch['chapter_num']} 章")
        row = acc.get(ch["chapter_id"], {})
        grid.append([round(row[a][0] / row[a][1], 2) if a in row and row[a][1]
                     else None for a in AXES])
    return {"axes": AXES, "chapters": chapters, "grid": grid}

