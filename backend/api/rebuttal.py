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
    material_ids: list[int] = Field(default_factory=list)  # 0.1.8 R2: 取消上限
    # 0.1.5 H1：用户拍板后重进的指定槽（含 offline=离线模板）；缺省槽 1
    provider: str | None = None


@router.get("/rebuttal/options")
def rebuttal_options():
    """供前端选择器：意图/格式/风格（含反面演示标记）/引用格式/检索模式。"""
    return {"intents": {k: v["label"] for k, v in INTENTS.items()},
            "formats": FORMATS,
            "styles": {k: {"label": v["label"],
                           "demo_warning": v["demo_warning"],
                           "stance_free": v.get("stance_free", False)}
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
        # 0.1.5 H1：流式入口走交互槽（失败推 slot_failed，不自动降级）
        for evt in engine.generate_stream(req.argument, req.stance,
                                          req.format, req.style,
                                          provider=req.provider,
                                          interactive=True, **kw):
            if evt["event"] == "meta":
                acc["provider"] = evt["data"].get("provider", "")
            elif evt["event"] == "delta":
                acc["rebuttal"] += evt["data"].get("text", "")
            elif evt["event"] == "done":
                acc["citations"] = evt["data"].get("citations", [])
            payload = json.dumps(evt["data"], ensure_ascii=False)
            yield f"event: {evt['event']}\ndata: {payload}\n\n"
        if acc["rebuttal"]:   # slot_failed 早退时不落空历史
            _record(engine, req, acc)

    return StreamingResponse(sse(), media_type="text/event-stream")


# ---------- 0.1.8 N1：双立场自动对辩（BgTask NDJSON，断流可重连续看） ----------

class DebateRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=2000)
    stance_a: str = Field(min_length=1)
    stance_b: str = Field(min_length=1)
    rounds: int = Field(default=3, ge=2, le=5)
    length: int | None = Field(default=None, ge=20, le=MAX_LENGTH)


def _debate_worker_factory(req: DebateRequest):
    def _worker(task):
        engine = get_engine()
        total = req.rounds * 2
        last_text = req.topic     # 首轮 a 立论=议题本身
        n = 0
        for rnd in range(1, req.rounds + 1):
            for side, stance in (("a", req.stance_a), ("b", req.stance_b)):
                if task.cancelled:
                    task.emit({"done": True, "ok": False, "detail": "对辩已取消"})
                    return
                n += 1
                task.emit({"status": f"第 {rnd} 轮 · {stance} 发言中…",
                           "percent": int((n - 1) * 100 / total)})
                try:
                    # 轮流以对方上轮输出为 argument 调 rebut 引擎
                    result = engine.generate(
                        last_text[:2000], stance, "argument", "rebuttal",
                        length=req.length, intent="rebut")
                    text = result.get("rebuttal") or ""
                except Exception as e:  # noqa: BLE001 单轮失败显式上报后终止
                    task.emit({"done": True, "ok": False,
                               "detail": f"第 {rnd} 轮 {stance} 生成失败：{e}"})
                    return
                task.emit({"round": rnd, "side": side, "stance": stance,
                           "text": text,
                           "percent": int(n * 100 / total)})
                last_text = text or last_text
        task.emit({"done": True, "ok": True,
                   "detail": f"对辩完成：{req.rounds} 轮 × 双方"})
    return _worker


@router.post("/debate")
def debate(req: DebateRequest, last_seq: int = 0):
    """双立场对辩：轮流以对方上轮输出为论点调反驳引擎，逐轮 NDJSON。"""
    if req.stance_a == req.stance_b:
        raise HTTPException(422, "对辩双方立场不能相同")
    if "none" in (req.stance_a, req.stance_b):
        raise HTTPException(422, "无立场不可作为对辩方")
    from tasks import BgTask
    task = BgTask.get_or_start("debate", _debate_worker_factory(req))
    return StreamingResponse(task.follow(last_seq),
                             media_type="application/x-ndjson")


@router.post("/debate/cancel")
def debate_cancel():
    """0.1.8 N1：显式取消对辩（断连不杀任务，只有这里杀）。"""
    from tasks import BgTask
    return {"cancelled": BgTask.cancel("debate")}
