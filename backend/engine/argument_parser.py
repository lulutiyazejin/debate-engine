"""ArgumentParser：对方论点 → 结构化 ParsedArgument（防稻草人）。

LLM 提取（parse 任务链），失败/离线时降级为规则解析。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ingestion.classifier import extract_json
from models.model_router import ModelRouter, get_router

_PARSE_PROMPT = (
    "解析以下辩论论点的逻辑结构，只输出 JSON：\n"
    "{\"core_claim\": \"核心主张（保留否定词与限定条件，不得曲解）\", "
    "\"conditions\": [\"限定条件\"], \"negations\": [\"否定成分\"], "
    "\"implicit_target\": \"论点隐含攻击的目标观点（用于检索）\", "
    "\"attack_surface\": [\"该论点可被攻击的薄弱环节\"]}\n\n"
    "对方论点：{argument}")

_CONDITION_WORDS = ("如果", "假如", "只要", "除非", "在…情况下", "当", "倘若")
_NEGATION_WORDS = ("不", "没", "无法", "并非", "未必", "不是", "绝非")


def _rule_parse(argument: str) -> dict:
    """降级规则解析：直接取原句，标注检测到的条件/否定词。"""
    conditions = [w for w in _CONDITION_WORDS if w in argument]
    negations = [w for w in _NEGATION_WORDS if w in argument]
    return {"core_claim": argument, "conditions": conditions,
            "negations": negations, "implicit_target": argument,
            "attack_surface": ["论据是否充分", "前提是否成立"]}


def parse_argument(argument: str, router: ModelRouter | None = None,
                   trace_id: str | None = None) -> dict:
    """返回 ParsedArgument dict，含 core_claim/conditions/negations/
    implicit_target/attack_surface 五字段（保证齐全）。"""
    argument = argument.strip()
    if not argument:
        raise ValueError("论点为空")
    r = router or get_router()
    out, provider = r.run(
        "parse",
        [{"role": "user",
          "content": _PARSE_PROMPT.replace("{argument}", argument[:1000])}],
        trace_id=trace_id, max_tokens=500, temperature=0.1)
    data = extract_json(out)
    base = _rule_parse(argument)
    if not data.get("core_claim"):
        data = base
    # 字段补全 + 类型清洗
    parsed = {
        "core_claim": str(data.get("core_claim") or argument)[:500],
        "conditions": [str(x) for x in data.get("conditions") or base["conditions"]],
        "negations": [str(x) for x in data.get("negations") or base["negations"]],
        "implicit_target": str(data.get("implicit_target") or argument)[:500],
        "attack_surface": [str(x) for x in
                           data.get("attack_surface") or base["attack_surface"]],
        "provider": provider,
    }
    # 防稻草人校验：原句有否定词但 core_claim 丢失 → 用原句
    orig_neg = any(w in argument for w in _NEGATION_WORDS)
    claim_neg = any(w in parsed["core_claim"] for w in _NEGATION_WORDS)
    if orig_neg and not claim_neg:
        parsed["core_claim"] = argument
    return parsed
