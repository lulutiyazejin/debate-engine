"""POST /api/rebuttal：论点 → 反驳（SSE 流式 + 同步 JSON 两种）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.deps import get_engine
from engine.rebuttal_engine import FORMATS, INTENTS, MAX_LENGTH, get_styles

router = APIRouter(prefix="/api", tags=["rebuttal"])


class RebuttalRequest(BaseModel):
    argument: str = Field(min_length=1, max_length=2000)
    stance: str = Field(min_length=1)
    format: str = "argument"
    style: str = "rebuttal"
    stream: bool = True
    length: int | None = Field(default=None, ge=20, le=MAX_LENGTH)
    cite_format: str = Field(default="plain",
                             pattern="^(plain|gbt7714|apa)$")
    fallacy: bool = True
    mode: str = Field(default="hybrid",
                      pattern="^(keyword|semantic|hybrid|smart)$")
    center: str | None = None
    intent: str = Field(default="rebut",
                        pattern="^(rebut|critique|evaluate)$")
    material_ids: list[int] = Field(default_factory=list, max_length=20)


@router.get("/rebuttal/options")
def rebuttal_options():
    """供前端选择器：意图/格式/风格（含反面演示标记）/引用格式/检索模式。"""
    return {"intents": {k: v["label"] for k, v in INTENTS.items()},
            "formats": FORMATS,
            "styles": {k: {"label": v["label"],
                           "demo_warning": v["demo_warning"]}
                       for k, v in get_styles().items()},
            "cite_formats": ["plain", "gbt7714", "apa"],
            "modes": ["keyword", "semantic", "hybrid", "smart"],
            "max_length": MAX_LENGTH}


def _record(engine, req: RebuttalRequest, result: dict) -> None:
    """回应历史落表（项目19）+ 素材标记已使用（项目18）。失败不阻断输出。"""
    try:
        engine.db.response_add(
            req.intent, req.argument, result.get("rebuttal") or "",
            citations_json=json.dumps(result.get("citations") or [],
                                      ensure_ascii=False),
            provider=result.get("provider") or "", stance=req.stance)
        if req.material_ids:
            engine.db.basket_mark_used(req.material_ids)
    except Exception:  # noqa: BLE001 历史记录失败不影响主链路
        pass


@router.post("/rebuttal")
def rebuttal(req: RebuttalRequest):
    if req.format not in FORMATS:
        raise HTTPException(422, f"未知格式 {req.format}，可选: {list(FORMATS)}")
    styles = get_styles()
    if req.style not in styles:
        raise HTTPException(422, f"未知风格 {req.style}，可选: {list(styles)}")
    engine = get_engine()
    materials = None
    if req.material_ids:
        wanted = set(req.material_ids)
        materials = [m for m in engine.db.basket_list() if m["id"] in wanted]
    kw = dict(length=req.length, cite_format=req.cite_format,
              fallacy=req.fallacy, mode=req.mode, center=req.center,
              intent=req.intent, materials=materials)
    if not req.stream:
        result = engine.generate(req.argument, req.stance, req.format,
                                 req.style, **kw)
        _record(engine, req, result)
        return result

    def sse():
        acc: dict = {"citations": [], "provider": "", "rebuttal": ""}
        for evt in engine.generate_stream(req.argument, req.stance,
                                          req.format, req.style, **kw):
            if evt["event"] == "meta":
                acc["provider"] = evt["data"].get("provider", "")
            elif evt["event"] == "delta":
                acc["rebuttal"] += evt["data"].get("text", "")
            elif evt["event"] == "done":
                acc["citations"] = evt["data"].get("citations", [])
            payload = json.dumps(evt["data"], ensure_ascii=False)
            yield f"event: {evt['event']}\ndata: {payload}\n\n"
        _record(engine, req, acc)

    return StreamingResponse(sse(), media_type="text/event-stream")
