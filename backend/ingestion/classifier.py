"""立场分类 + 意识形态坐标提取。

坐标：9 大轴意识形态坐标（-5 ~ +5），Ollama 优先（敏感内容本地处理）。
立场分类：向量相似（摘要 vs 各立场 Skill 世界观）+ LLM 复核，输出置信度。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models.embedder import get_embedder
from models.model_router import ModelRouter, get_router
from storage.skill_loader import get_skill_loader

AXES_CORE = ["ownership", "political_authority", "imperialism", "epistemology",
             "change_speed", "ethics", "culture", "diplomacy", "technology"]

# 0.1.1（项目10）：按架构 §16.1 补齐 13 轴（核心 9 轴必填，扩展尽力而为）
AXES_EXTENDED = ["distribution", "welfare", "democracy_type", "organization",
                 "constitutionalism", "identity", "gender", "secularism",
                 "ontology", "ecology", "ai_automation", "globalization",
                 "historical_view"]

AXES = AXES_CORE + AXES_EXTENDED

_IDEOLOGY_PROMPT = (
    "分析以下文档摘要的意识形态坐标。对每个轴输出 -5 到 +5 的整数：\n"
    "ownership(-5全公有 +5全私有), political_authority(-5集权 +5无政府), "
    "imperialism(-5反帝 +5干涉主义), epistemology(-5理性建构 +5经验演化), "
    "change_speed(-5革命 +5保守), ethics(-5结果主义 +5义务论), "
    "culture(-5进步 +5传统), diplomacy(-5民族 +5世界主义), "
    "technology(-5怀疑 +5加速主义)。\n"
    "只输出 JSON 对象，键为轴名，值为整数。\n\n摘要：\n{summary}")

# 扩展 13 轴单独一段提示词（分两段避免漏轴）；两极语义出自架构 §16.1
_IDEOLOGY_EXT_PROMPT = (
    "继续分析同一文档摘要的扩展意识形态坐标。对每个轴输出 -5 到 +5 的整数，"
    "文本未涉及的轴可省略：\n"
    "distribution(-5平均主义 +5绩效主义), welfare(-5强福利国家 +5自力更生), "
    "democracy_type(-5直接民主 +5精英代议), organization(-5先锋党纪律 +5无政府自组织), "
    "constitutionalism(-5人治/党治 +5宪政法治), identity(-5阶级政治优先 +5身份政治优先), "
    "gender(-5父权传统 +5女权/性别流动), secularism(-5政教合一 +5彻底世俗), "
    "ontology(-5整体主义 +5原子个人主义), ecology(-5生态中心/深绿 +5人类中心/发展优先), "
    "ai_automation(-5技术恐惧 +5加速主义), globalization(-5反全球化 +5亲全球化), "
    "historical_view(-5唯物决定论 +5观念/意志论)。\n"
    "只输出 JSON 对象，键为轴名，值为整数。\n\n摘要：\n{summary}")

_CLASSIFY_PROMPT = (
    "根据以下文档摘要，从这些立场中选择最匹配的一个：{stances}。\n"
    "只输出 JSON：{{\"stance\": \"名称\", \"confidence\": 0到1小数, "
    "\"reason\": \"一句话理由\"}}\n\n摘要：\n{summary}")


def extract_json(text: str) -> dict:
    """从 LLM 输出中稳健提取第一个 JSON 对象。"""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def extract_coordinates(summary: str, router: ModelRouter | None = None,
                        trace_id: str | None = None) -> dict:
    """22 轴意识形态坐标（两段提示词避免漏轴）。

    核心 9 轴解析失败补 0；扩展 13 轴缺失补 0 并记入 low_confidence_axes
    （随 coordinates 写入 meta.json）。坐标任务走本地优先链（敏感内容）。"""
    r = router or get_router()
    coords: dict = {}
    low_conf: list[str] = []

    out, _ = r.run("ideology",
                   [{"role": "user",
                     "content": _IDEOLOGY_PROMPT.format(summary=summary[:3000])}],
                   trace_id=trace_id, max_tokens=300, temperature=0.1)
    data = extract_json(out)
    for ax in AXES_CORE:
        try:
            coords[ax] = max(-5, min(5, int(data.get(ax, 0))))
        except (TypeError, ValueError):
            coords[ax] = 0

    out2, _ = r.run("ideology",
                    [{"role": "user",
                      "content": _IDEOLOGY_EXT_PROMPT.format(
                          summary=summary[:3000])}],
                    trace_id=trace_id, max_tokens=400, temperature=0.1)
    data2 = extract_json(out2)
    for ax in AXES_EXTENDED:
        v = data2.get(ax)
        try:
            if v is None:
                raise ValueError
            coords[ax] = max(-5, min(5, int(v)))
        except (TypeError, ValueError):
            coords[ax] = 0
            low_conf.append(ax)
    coords["low_confidence_axes"] = low_conf
    return coords


def _vector_scores(summary: str) -> dict[str, float]:
    """摘要与各立场 Skill 世界观文本的 cosine 相似度。"""
    loader = get_skill_loader()
    stances = loader.stances()
    if not stances:
        return {}
    emb = get_embedder()
    names = list(stances.keys())
    texts = [s.get("世界观假设") + "\n" + s.get("反驳策略偏好")
             for s in stances.values()]
    vecs = emb.embed_batch([summary] + texts)
    q = vecs[0]
    out = {}
    for name, v in zip(names, vecs[1:]):
        denom = (np.linalg.norm(q) * np.linalg.norm(v)) + 1e-9
        out[name] = float(q @ v / denom)
    return out


def classify_stance(summary: str, router: ModelRouter | None = None,
                    trace_id: str | None = None,
                    doc_type: str | None = None) -> dict:
    """立场分类：向量粗排 + LLM 复核（入库 Skill 注入 system 段）。
    返回 {stance, confidence, reason, vector_scores}。"""
    from ingestion.summarizer import skill_system_messages
    vec_scores = _vector_scores(summary)
    candidates = sorted(vec_scores, key=vec_scores.get, reverse=True) or \
        ["liberal", "marxist", "conservative", "social_democracy", "empirical"]

    r = router or get_router()
    out, provider = r.run(
        "classify",
        skill_system_messages(doc_type) +
        [{"role": "user",
          "content": _CLASSIFY_PROMPT.format(stances="、".join(candidates),
                                             summary=summary[:3000])}],
        trace_id=trace_id, max_tokens=200, temperature=0.1)
    data = extract_json(out)
    stance = data.get("stance", "")
    if stance not in candidates:
        # LLM 输出无效 → 退回向量最高分
        stance = candidates[0]
        confidence = round(max(vec_scores.values()), 2) if vec_scores else 0.3
        reason = "LLM 分类无效，采用向量相似度最高的立场"
    else:
        try:
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        reason = str(data.get("reason", ""))[:200]
    return {"stance": stance, "confidence": confidence, "reason": reason,
            "vector_scores": {k: round(v, 4) for k, v in vec_scores.items()},
            "provider": provider}
