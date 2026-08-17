"""章节摘要与全文总结：Map-Reduce（默认）/ Refine Chain / 全文投喂 三策略。

全部经模型路由器 summarize 任务链（Gemini → Cerebras → Groq → Ollama → 离线）。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models.model_router import ModelRouter, get_router

_CHAPTER_PROMPT = (
    "你是文档分析助手。请为以下章节生成不超过150字的中文摘要，"
    "保留核心论点与关键论据，不加评论。\n\n章节《{title}》：\n{text}")

_REDUCE_PROMPT = (
    "以下是一本文档各章节的摘要，请综合为一段不超过300字的全书总结，"
    "点明作者的核心主张与论证脉络。\n\n{summaries}")

_REFINE_PROMPT = (
    "已有前文总结：\n{existing}\n\n请结合下一章内容更新总结（不超过300字），"
    "保留跨章逻辑递进关系。\n\n新章节《{title}》：\n{text}")

_MAX_INPUT_CHARS = 6000  # 单次请求注入的章节文本上限


def summarize_chapter(title: str, text: str,
                      router: ModelRouter | None = None,
                      trace_id: str | None = None) -> str:
    r = router or get_router()
    prompt = _CHAPTER_PROMPT.format(title=title, text=text[:_MAX_INPUT_CHARS])
    out, _ = r.run("summarize", [{"role": "user", "content": prompt}],
                   trace_id=trace_id, max_tokens=400, temperature=0.3)
    return out.strip()


def summarize_document(chapter_summaries: list[str],
                       router: ModelRouter | None = None,
                       trace_id: str | None = None) -> str:
    """Map-Reduce 默认策略：各章摘要 → 全书总结。"""
    r = router or get_router()
    joined = "\n".join(f"{i+1}. {s}" for i, s in enumerate(chapter_summaries))
    out, _ = r.run("summarize",
                   [{"role": "user",
                     "content": _REDUCE_PROMPT.format(summaries=joined[:8000])}],
                   trace_id=trace_id, max_tokens=600, temperature=0.3)
    return out.strip()


def summarize_refine(chapters: list[tuple[str, str]],
                     router: ModelRouter | None = None,
                     trace_id: str | None = None) -> str:
    """Refine Chain：逻辑递进著作，串行逐章更新总结。"""
    r = router or get_router()
    summary = ""
    for title, text in chapters:
        prompt = _REFINE_PROMPT.format(existing=summary or "（暂无）",
                                       title=title, text=text[:_MAX_INPUT_CHARS])
        summary, _ = r.run("summarize", [{"role": "user", "content": prompt}],
                           trace_id=trace_id, max_tokens=600, temperature=0.3)
    return summary.strip()
