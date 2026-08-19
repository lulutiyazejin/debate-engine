"""章节摘要与全文总结：Map-Reduce（默认）/ Refine Chain / 全文投喂 三策略。

全部经模型路由器 summarize 任务链（Gemini → Cerebras → Groq → Ollama → 离线）。
0.1.1（项目4/5）：
- Skill 真注入：按文档类型选入库 Skill，指导内容进 system 段
- 章节摘要与论证单元合并提取（单次调用；解析失败降级两次独立调用）
- Excel 表格先转述为自然语言再分析
- full_context 策略 + auto 判定（小文档整书投喂，超限回落 Map-Reduce）
0.1.5（F4/G1）：
- summary_window：摘要任务当前落点窗口（读 G2 表/F2 档值）
- pick_strategy 判墙改读落点窗×0.9 余量线
- 超长章拆多趟提取（不截章尾）
- 小档模型（≤7B 稠密）模板变体：短指令+步骤显式+完整 JSON 示例
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models.model_router import ModelRouter, get_router
from storage.skill_loader import get_skill_loader

_CHAPTER_PROMPT = (
    "你是文档分析助手。请为以下章节生成不超过150字的中文摘要，"
    "保留核心论点与关键论据，不加评论。\n\n章节《{title}》：\n{text}")

_REDUCE_PROMPT = (
    "以下是一本文档各章节的摘要，请综合为一段不超过300字的全书总结，"
    "点明作者的核心主张与论证脉络。\n\n{summaries}")

_REFINE_PROMPT = (
    "已有前文总结：\n{existing}\n\n请结合下一章内容更新总结（不超过300字），"
    "保留跨章逻辑递进关系。\n\n新章节《{title}》：\n{text}")

# 合并提取（项目4）：摘要 + 论证单元一次调用
_CHAPTER_ARGS_PROMPT = (
    "你是文档分析助手。请分析以下章节，只输出 JSON（不要其他文字）：\n"
    '{{"summary": "不超过150字的中文摘要，保留核心论点与关键论据",\n'
    ' "arg_units": [{{"claim": "论点（一句话）", "evidence": "支撑论据",\n'
    '  "logic_pattern": "推理方式（演绎/归纳/类比/因果等）",\n'
    '  "thinker": "论点归属思想家（没有则空字符串）",\n'
    '  "school": "所属流派（没有则空字符串）"}}]}}\n'
    "arg_units 提取本章 1-5 条最重要的论证单元。\n\n"
    "章节《{title}》：\n{text}")

# 降级第二跳：只提取论证单元
_ARGS_ONLY_PROMPT = (
    "从以下章节提取 1-5 条最重要的论证单元，只输出 JSON：\n"
    '{{"arg_units": [{{"claim": "...", "evidence": "...",'
    ' "logic_pattern": "...", "thinker": "", "school": ""}}]}}\n\n'
    "章节《{title}》：\n{text}")

# Excel 表格转述（项目4）
_EXCEL_PROMPT = (
    "以下是电子表格的结构化内容。请把行列数据转述为不超过200字的自然语言段落，"
    "点明表格主题、关键数据与变化趋势，不要逐行罗列。\n\n表《{title}》：\n{text}")

# 全文投喂（项目5）
_FULL_CONTEXT_PROMPT = (
    "请通读以下整本文档，输出一段不超过300字的全书总结，"
    "点明作者的核心主张与论证脉络。\n\n{text}")

# G1 小档模板（≤7B 稠密）：短指令+步骤显式+完整 JSON 示例，不要求自由推理
_CHAPTER_PROMPT_SMALL = (
    "任务：写章节摘要。\n步骤：1.通读全文 2.找核心论点 "
    "3.用中文写一段不超过150字的摘要。\n"
    "只输出摘要正文，不要标题、不要解释。\n\n章节《{title}》：\n{text}")

_CHAPTER_ARGS_PROMPT_SMALL = (
    "任务：输出 JSON，包含摘要与论证单元。\n"
    "步骤：1.通读全文 2.写不超过150字中文摘要 3.列出1-3条论证单元。\n"
    "严格按下面示例的格式输出，不要输出任何多余文字：\n"
    '{{"summary": "本章认为市场机制优于计划配置，并以价格信号为核心论据。",\n'
    ' "arg_units": [{{"claim": "市场机制优于计划配置",\n'
    '  "evidence": "价格信号能实时传递稀缺信息",\n'
    '  "logic_pattern": "因果", "thinker": "", "school": ""}}]}}\n\n'
    "章节《{title}》：\n{text}")

_ARGS_ONLY_PROMPT_SMALL = (
    "任务：从章节提取1-3条论证单元，输出 JSON。\n"
    "严格按下面示例的格式输出，不要输出任何多余文字：\n"
    '{{"arg_units": [{{"claim": "市场机制优于计划配置",\n'
    '  "evidence": "价格信号能实时传递稀缺信息",\n'
    '  "logic_pattern": "因果", "thinker": "", "school": ""}}]}}\n\n'
    "章节《{title}》：\n{text}")

_REDUCE_PROMPT_SMALL = (
    "任务：把各章摘要合并成全书总结。\n步骤：1.通读各章摘要 2.找共同主张 "
    "3.用中文写一段不超过300字的总结。\n只输出总结正文。\n\n{summaries}")

# F4：超长章分段摘要的段间合并
_SEG_MERGE_PROMPT = (
    "以下是同一章节各段的摘要，请合并为一段不超过150字的中文章节摘要，"
    "保留核心论点。只输出摘要正文。\n\n{parts}")

_MAX_INPUT_CHARS = 6000  # 单次请求注入的章节文本上限


def summary_window(router: ModelRouter | None = None) -> tuple[int, str, str]:
    """F4/F5：摘要任务当前落点 (窗口tokens, provider, model)。
    槽序找首个可用：ollama→F2 档值（G2 表）；云端→FULL_CONTEXT_TOKEN_LIMIT；
    全不可用→(0, offline, '')。"""
    r = router or get_router()
    chains = config.effective_task_chains().get("summarize", [])
    models = config.effective_provider_models()
    for name in chains:
        p = r.providers.get(name)
        if p is None or not p.available():
            continue
        model = models.get(name) or getattr(p, "model", "") or ""
        if name == "ollama":
            from models.model_matrix import effective_ctx
            return effective_ctx(model), name, model
        return int(config.FULL_CONTEXT_TOKEN_LIMIT), name, model
    return 0, "offline", ""


def _prompt_tier(router: ModelRouter | None = None) -> str:
    """G1：摘要落点为本地小模型（≤7B 稠密）时切小档模板。"""
    _, provider, model = summary_window(router)
    if provider == "ollama":
        from models.model_matrix import prompt_tier_of
        return prompt_tier_of(model)
    return "large"


def _segments(text: str) -> list[str]:
    """F4：超长章拆多趟提取（不截章尾）。"""
    return [text[i:i + _MAX_INPUT_CHARS]
            for i in range(0, len(text), _MAX_INPUT_CHARS)] or [""]


def skill_system_messages(doc_type: str | None) -> list[dict]:
    """按文档类型取入库 Skill，指导内容注入 system 段（找不到回退 default）。"""
    if not doc_type:
        return []
    name = {"excel": "data_table"}.get(doc_type, doc_type)
    sk = get_skill_loader().get_ingestion(name)
    if sk is None or not sk.sections:
        return []
    guide = "\n\n".join(f"## {k}\n{v}" for k, v in sk.sections.items())
    return [{"role": "system",
             "content": f"入库分析规则《{sk.title}》：\n{guide[:2000]}"}]


def summarize_chapter(title: str, text: str,
                      router: ModelRouter | None = None,
                      trace_id: str | None = None,
                      doc_type: str | None = None) -> str:
    r = router or get_router()
    tpl = _CHAPTER_PROMPT_SMALL if _prompt_tier(r) == "small" else _CHAPTER_PROMPT
    prompt = tpl.format(title=title, text=text[:_MAX_INPUT_CHARS])
    msgs = skill_system_messages(doc_type) + [{"role": "user", "content": prompt}]
    out, _ = r.run("summarize", msgs,
                   trace_id=trace_id, max_tokens=400, temperature=0.3)
    return out.strip()


def _extract_one(title: str, body: str, r: ModelRouter, sys_msgs: list[dict],
                 trace_id: str | None, tier: str) -> tuple[str, list[dict]]:
    """单趟合并提取（body 已在长度限内）；解析失败降级两次独立调用。"""
    from ingestion.classifier import extract_json
    tpl = _CHAPTER_ARGS_PROMPT_SMALL if tier == "small" else _CHAPTER_ARGS_PROMPT
    out, _ = r.run("summarize", sys_msgs + [
        {"role": "user", "content": tpl.format(title=title, text=body)}],
        trace_id=trace_id, max_tokens=900, temperature=0.3)
    data = extract_json(out)
    if isinstance(data, dict) and data.get("summary"):
        units = [u for u in data.get("arg_units", [])
                 if isinstance(u, dict) and u.get("claim")]
        return str(data["summary"]).strip(), units
    # 降级：独立摘要 + 独立提取
    summary = summarize_chapter(title, body, router=r, trace_id=trace_id)
    tpl2 = _ARGS_ONLY_PROMPT_SMALL if tier == "small" else _ARGS_ONLY_PROMPT
    out2, _ = r.run("summarize", sys_msgs + [
        {"role": "user", "content": tpl2.format(title=title, text=body)}],
        trace_id=trace_id, max_tokens=600, temperature=0.3)
    data2 = extract_json(out2)
    units = [u for u in data2.get("arg_units", [])
             if isinstance(u, dict) and u.get("claim")] \
        if isinstance(data2, dict) else []
    return summary, units


def summarize_chapter_with_args(title: str, text: str,
                                router: ModelRouter | None = None,
                                trace_id: str | None = None,
                                doc_type: str | None = None
                                ) -> tuple[str, list[dict]]:
    """合并提取：返回 (章节摘要, 论证单元列表)。
    F4：超长章拆多趟提取后段间合并（不截章尾）。"""
    r = router or get_router()
    sys_msgs = skill_system_messages(doc_type)
    tier = _prompt_tier(r)
    if doc_type == "excel":
        # 表格先转述为自然语言，再做摘要与论证单元提取
        out, _ = r.run("summarize", sys_msgs + [
            {"role": "user",
             "content": _EXCEL_PROMPT.format(
                 title=title, text=text[:_MAX_INPUT_CHARS])}],
            trace_id=trace_id, max_tokens=400, temperature=0.3)
        body = out.strip() or text[:_MAX_INPUT_CHARS]
        return _extract_one(title, body, r, sys_msgs, trace_id, tier)
    segs = _segments(text)
    if len(segs) == 1:
        return _extract_one(title, segs[0], r, sys_msgs, trace_id, tier)
    # 多趟：逐段提取 → 段摘要合并 + 论证单元并集
    parts: list[str] = []
    units_all: list[dict] = []
    for i, seg in enumerate(segs):
        s, u = _extract_one(f"{title}（第{i + 1}/{len(segs)}段）", seg,
                            r, sys_msgs, trace_id, tier)
        if s:
            parts.append(s)
        units_all.extend(u)
    joined = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(parts))
    merged, _ = r.run("summarize", sys_msgs + [
        {"role": "user",
         "content": _SEG_MERGE_PROMPT.format(parts=joined[:_MAX_INPUT_CHARS])}],
        trace_id=trace_id, max_tokens=400, temperature=0.3)
    return merged.strip() or (parts[0] if parts else ""), units_all[:10]


def summarize_document(chapter_summaries: list[str],
                       router: ModelRouter | None = None,
                       trace_id: str | None = None) -> str:
    """Map-Reduce 默认策略：各章摘要 → 全书总结。"""
    r = router or get_router()
    tpl = _REDUCE_PROMPT_SMALL if _prompt_tier(r) == "small" else _REDUCE_PROMPT
    joined = "\n".join(f"{i+1}. {s}" for i, s in enumerate(chapter_summaries))
    out, _ = r.run("summarize",
                   [{"role": "user",
                     "content": tpl.format(summaries=joined[:8000])}],
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


def summarize_full_context(full_text: str,
                           router: ModelRouter | None = None,
                           trace_id: str | None = None) -> str:
    """全文投喂：整书单次总结（调用方负责确认 token 在窗口内）。"""
    r = router or get_router()
    limit = int(config.FULL_CONTEXT_TOKEN_LIMIT * 1.5)  # 中文 1 token≈1.5 字
    out, _ = r.run("summarize",
                   [{"role": "user",
                     "content": _FULL_CONTEXT_PROMPT.format(
                         text=full_text[:limit])}],
                   trace_id=trace_id, max_tokens=600, temperature=0.3)
    return out.strip()


def pick_strategy(strategy: str, token_estimate: int,
                  router: ModelRouter | None = None) -> str:
    """F4 判墙：auto 读摘要落点窗×0.9 余量线，超线强制 Map-Reduce；
    显式选择（map_reduce/refine/full_context）尊重不改。"""
    if strategy != "auto":
        return strategy
    win, provider, _ = summary_window(router)
    if provider == "offline" or win <= 0:
        return "map_reduce"
    margin = min(int(config.FULL_CONTEXT_TOKEN_LIMIT), int(win * 0.9))
    if token_estimate <= margin:
        return "full_context"
    return "map_reduce"
