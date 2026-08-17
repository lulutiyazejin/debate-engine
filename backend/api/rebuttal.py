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
from engine.rebuttal_engine import FORMATS, MAX_LENGTH, get_styles

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


@router.get("/rebuttal/options")
def rebuttal_options():
    """供前端选择器：格式/风格（含反面演示标记）/引用格式/检索模式。"""
    return {"formats": FORMATS,
            "styles": {k: {"label": v["label"],
                           "demo_warning": v["demo_warning"]}
                       for k, v in get_styles().items()},
            "cite_formats": ["plain", "gbt7714", "apa"],
            "modes": ["keyword", "semantic", "hybrid", "smart"],
            "max_length": MAX_LENGTH}


@router.post("/rebuttal")
def rebuttal(req: RebuttalRequest):
    if req.format not in FORMATS:
        raise HTTPException(422, f"未知格式 {req.format}，可选: {list(FORMATS)}")
    styles = get_styles()
    if req.style not in styles:
        raise HTTPException(422, f"未知风格 {req.style}，可选: {list(styles)}")
    engine = get_engine()
    kw = dict(length=req.length, cite_format=req.cite_format,
              fallacy=req.fallacy, mode=req.mode)
    if not req.stream:
        return engine.generate(req.argument, req.stance, req.format,
                               req.style, **kw)

    def sse():
        for evt in engine.generate_stream(req.argument, req.stance,
                                          req.format, req.style, **kw):
            payload = json.dumps(evt["data"], ensure_ascii=False)
            yield f"event: {evt['event']}\ndata: {payload}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
