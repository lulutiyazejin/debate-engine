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
from engine.rebuttal_engine import FORMATS, STYLES

router = APIRouter(prefix="/api", tags=["rebuttal"])


class RebuttalRequest(BaseModel):
    argument: str = Field(min_length=1, max_length=2000)
    stance: str = Field(min_length=1)
    format: str = "argument"
    style: str = "rebuttal"
    stream: bool = True


@router.post("/rebuttal")
def rebuttal(req: RebuttalRequest):
    if req.format not in FORMATS:
        raise HTTPException(422, f"未知格式 {req.format}，可选: {list(FORMATS)}")
    if req.style not in STYLES:
        raise HTTPException(422, f"未知风格 {req.style}，可选: {list(STYLES)}")
    engine = get_engine()
    if not req.stream:
        return engine.generate(req.argument, req.stance, req.format, req.style)

    def sse():
        for evt in engine.generate_stream(req.argument, req.stance,
                                          req.format, req.style):
            payload = json.dumps(evt["data"], ensure_ascii=False)
            yield f"event: {evt['event']}\ndata: {payload}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")
