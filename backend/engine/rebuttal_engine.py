"""反驳生成引擎：Top-5 资料 + Skill Prompt + 格式/风格 → 带真实引用的反驳。

防幻觉三重机制：
1. 引用元数据（作者/年份/页码）注入 prompt，编号 [C1]..[Cn]
2. 要求 LLM 只使用注入的引用 ID
3. 输出后验证：无效引用 ID → 重试一次 → 仍失败则剥除无效引用并加警示
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Generator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import log_error, new_trace_id
from engine.argument_parser import detect_fallacies
from engine.reranker import RetrievalChain
from models.model_router import (ModelRouter, SlotFailure, get_router)
from storage.skill_loader import get_skill_loader
from storage.sqlite_store import SqliteStore

FORMATS = {
    "quick": "速辩：3 句话以内，直击要害，使用 1-2 个引用",
    "argument": "论证：结构化段落（复述对方论点→指出漏洞→展开反驳→结论），完整论证链",
    "report": "报告：学术格式，分节论述，结尾附完整参考文献列表",
    "plain": "日常：自然段随笔，不设固定结构，像日常写作一样把话说清楚",   # 0.1.9 R1
}

# 内置默认风格（styles.md 缺失时回落，项目7）
_BUILTIN_STYLES = {
    "rebuttal": "反驳（正面驳斥）", "critique": "批判性分析",
    "socratic": "苏格拉底式提问", "steelman": "先钢人再反驳",
    "data": "数据实证导向", "historical": "历史案例导向",
    "concise": "极简犀利", "formal": "正式书面",
    "daily": "日常（口语、短句、无术语堆砌）",   # 0.1.9 R1
}


def get_styles() -> dict[str, dict]:
    """风格库：styles.md 启动加载，缺失回落内置。
    返回 {key: {label, prompt, demo_warning}}。"""
    loaded = get_skill_loader().styles()
    if loaded:
        return loaded
    return {k: {"label": v, "prompt": v, "demo_warning": False}
            for k, v in _BUILTIN_STYLES.items()}


# 向后兼容别名（旧代码/测试引用 STYLES 键集合做校验）
STYLES = _BUILTIN_STYLES

MAX_LENGTH = 2000  # 字数参数上限（汉字）

_CITE_RE = re.compile(r"\[C(\d+)\]")


def format_citations(citations: list[dict], fmt: str = "plain") -> list[str]:
    """引用导出（项目7；0.1.3 B2 补译者/出版社）。"""
    out = []
    for i, c in enumerate(citations, start=1):
        author, title = c.get("author") or "佚名", c.get("title") or "未知文献"
        year, pages = c.get("year") or "", c.get("pages") or ""
        translator = c.get("translator") or ""      # 0.1.3 B2
        publisher = c.get("publisher") or ""        # 0.1.3 B2
        if fmt == "gbt7714":
            s = f"[{i}] {author}. {title}[M]."
            if year:
                s += f" {year}."
            if publisher:
                s += f" {publisher}."
            if translator:
                s += f" Translator: {translator}"
            if pages:
                s += f" Pp.{pages}."
        elif fmt == "apa":
            s = f"{author} ({year or 'n.d.'}). {title}."
            if publisher:
                s += f" {publisher}."
            if translator:
                s += f" Translated by {translator}."
            if pages:
                s += f" pp. {pages}."
        else:
            s = f"{author}《{title}》"
            if year:
                s += f"({year})"
            if pages:
                s += f" {pages}"
            if translator:
                s += f"（译：{translator}）"
            if publisher:
                s += f"·{publisher}"
        out.append(s)
    return out


def _char_overlap(output: str, texts: list[str]) -> float:
    """免费评分维度二：块利用率 = 生成文本与检索块的字符重叠率（bigram）。"""
    if not output or not texts:
        return 0.0
    grams = {output[i:i + 2] for i in range(len(output) - 1)}
    src = set()
    for t in texts:
        src |= {t[i:i + 2] for i in range(len(t) - 1)}
    if not grams:
        return 0.0
    return round(len(grams & src) / len(grams), 4)


def build_citations(chunks: list[dict], db: SqliteStore) -> list[dict]:
    """从 chunk + documents 表组装引用元数据。"""
    cites = []
    for i, c in enumerate(chunks, start=1):
        doc = db.get_document(c["doc_id"]) or {}
        cites.append({
            "id": f"C{i}", "chunk_id": c["chunk_id"], "doc_id": c["doc_id"],
            "author": doc.get("author") or "佚名",
            "title": doc.get("title") or "未知文献",
            "year": doc.get("year") or "",
            "pages": c.get("page_range") or "",
            "text": c["text"]})
    return cites


# 回应意图（项目16：一级选择；analyze/report 走对齐与报告引擎，不在此表）
INTENTS = {
    "rebut": {"label": "反驳", "extra": "", "verb": "反驳"},
    "critique": {"label": "批判", "verb": "批判",
                 "extra": "任务改为「批判」：不必逐点驳斥结论，而是攻击对方论证"
                          "结构本身——前提是否可靠、推理有无跳跃、概念是否偷换、"
                          "证据与结论是否匹配；输出以对方论证的结构性缺陷清单收尾。"},
    "evaluate": {"label": "评价", "verb": "评价",
                 "extra": "任务改为「评价」：不站队攻击，做多立场权衡——分别列出"
                          "该论点的合理之处与薄弱之处，引用资料分别佐证；"
                          "不下唯一裁决，结尾给出条件式结论（在什么前提下成立/不成立）。"},
}


def build_prompt(argument: str, parsed: dict, citations: list[dict],
                 stance: str, fmt: str, style: str,
                 length: int | None = None,
                 fallacies: list[dict] | None = None,
                 intent: str = "rebut",
                 tier: str = "large") -> list[dict]:
    # 0.1.4 批 3：stance="none" = 不站队评价（stance_free 风格），跳过 skill 注入
    if stance == "none":
        skill = None
        sys_prompt = ("你是一名不站队的理性评审，基于提供的资料对输入论点做多立场权衡，"
                      "对各方论据一视同仁，不预设立场。")
    else:
        skill = get_skill_loader().get_stance(stance)
        sys_prompt = (skill.prompt_template if skill else
                      "你是一名理性辩手，基于提供的资料反驳对方论点。")
    styles = get_styles()
    style_prompt = styles.get(style, {}).get("prompt") or style
    it = INTENTS.get(intent, INTENTS["rebut"])
    if tier == "small":
        # G1 小档（≤7B 稠密）：短指令+步骤显式，不要求自由推理
        sys_prompt += (f"\n\n任务步骤：1.读对方论点 2.找薄弱环节 "
                       f"3.用下方资料写{it['verb']}。\n"
                       f"输出要求：{FORMATS.get(fmt, FORMATS['argument'])}；"
                       f"风格：{style_prompt}。\n"
                       "规则：引用只能写 [C1] 这种资料编号，"
                       "不要编造作者、书名或数据。")
    else:
        sys_prompt += (f"\n\n输出要求：{FORMATS.get(fmt, FORMATS['argument'])}；"
                       f"风格要点：{style_prompt}。\n"
                       "引用规则：只能使用下方资料的引用 ID（如 [C1]），"
                       "严禁编造任何未提供的作者、书名或数据。\n"
                       "写作自检：你的反驳自身不得犯稻草人、假因果、诉诸情感等逻辑谬误。")
    if it["extra"]:
        sys_prompt += f"\n{it['extra']}"
    if length:
        sys_prompt += f"\n篇幅要求：输出正文约 {length} 个汉字（允许±30%）。"
        if length <= 300:
            sys_prompt += "篇幅短，引用 1-2 条即可。"
    lines = [f"对方论点：{argument}", "",
             f"论点解析：核心主张={parsed['core_claim']}；"
             f"薄弱环节={'、'.join(parsed['attack_surface'][:3])}", ""]
    if fallacies:
        lines.append("对方论点疑似存在以下逻辑谬误（仅供参考，可在反驳中点名，"
                     "措辞用“疑似”）：")
        for f in fallacies:
            lines.append(f"- 疑似{f['name']}：“{f['quote']}”（{f['reason']}）")
        lines.append("")
    lines += [f"可用资料（{len(citations)}条）："]
    for c in citations:
        head = f"[{c['id']}] {c['author']}《{c['title']}》"
        if c["year"]:
            head += f"({c['year']})"
        if c["pages"]:
            head += f" {c['pages']}"
        if c.get("must_use"):
            head = f"★用户指定素材，必须引用 {head}"
        lines.append(f"{head}：{c['text'][:800]}")
    lines += ["", f"请生成{it['verb']}，引用只能使用以上资料的 [C编号]。"]
    return [{"role": "system", "content": sys_prompt},
            {"role": "user", "content": "\n".join(lines)}]


def validate_citations(output: str, citations: list[dict]) -> list[str]:
    """返回输出中不存在于注入 context 的引用 ID 列表（空 = 通过）。"""
    valid = {c["id"] for c in citations}
    used = {f"C{m}" for m in _CITE_RE.findall(output)}
    return sorted(used - valid)


class RebuttalEngine:
    def __init__(self, chain: RetrievalChain | None = None,
                 router: ModelRouter | None = None,
                 sqlite: SqliteStore | None = None):
        self.db = sqlite or SqliteStore()
        self.chain = chain or RetrievalChain(sqlite=self.db, router=router)
        self.router = router or get_router()

    def _tier(self, provider_override: str | None = None) -> str:
        """G1：rebuttal 任务落点为本地小模型（≤7B 稠密）时切小档模板。"""
        from models.model_matrix import prompt_tier_of
        name = provider_override
        if not name:
            chains = config.effective_task_chains().get("rebuttal", [])
            name = next((n for n in chains
                         if n in self.router.providers
                         and self.router.providers[n].available()), None)
        if name == "ollama":
            model = config.effective_provider_models().get("ollama", "")
            return prompt_tier_of(model)
        return "large"

    def generate(self, argument: str, stance: str, fmt: str = "argument",
                 style: str = "rebuttal",
                 trace_id: str | None = None,
                 length: int | None = None,
                 cite_format: str = "plain",
                 fallacy: bool = True,
                 mode: str = "hybrid",
                 center: str | None = None,
                 intent: str = "rebut",
                 materials: list[dict] | None = None,
                 provider: str | None = None,
                 interactive: bool = False) -> dict:
        """完整链路：检索 → 谬误检测 → 组装 → 生成 → 引用验证（失败重试一次）。
        intent=五意图之三（rebut/critique/evaluate）；materials=素材篮强制引用候选；
        0.1.5 H1：interactive=True 槽失败抛 SlotFailure 交前端动作 toast；
        provider=用户拍板后重进的指定槽（含 offline）。"""
        if length is not None and (length < 20 or length > MAX_LENGTH):
            raise ValueError(f"字数参数超出范围（20-{MAX_LENGTH}）: {length}")
        trace_id = trace_id or new_trace_id()
        # 0.1.4 批 3 兜底（决策 16-E）：风格命中立场 method_blacklist → 回落默认笔法
        _skill = get_skill_loader().get_stance(stance)
        if _skill and style in _skill.method_blacklist:
            style = "rebuttal"
        r = self.chain.run(argument, stance, style=style, trace_id=trace_id,
                           mode=mode, center=center)
        citations = build_citations(r["chunks"], self.db)
        # 素材篮条目置顶为必用引用候选，与检索结果统一重编号（项目18）
        if materials:
            mats = [{"id": "", "chunk_id": str(m.get("ref_id") or ""),
                     "doc_id": "basket", "author": m.get("source") or "素材篮",
                     "title": "用户指定素材", "year": "", "pages": "",
                     "text": (m.get("excerpt") or "")[:800], "must_use": True}
                    for m in materials if m.get("excerpt")]
            citations = mats + citations
            for i, c in enumerate(citations, 1):
                c["id"] = f"C{i}"
        fallacies = detect_fallacies(argument, router=self.router,
                                     trace_id=trace_id) if fallacy else []
        messages = build_prompt(argument, r["parsed_argument"], citations,
                                stance, fmt, style, length=length,
                                fallacies=fallacies, intent=intent,
                                tier=self._tier(provider))

        if interactive:
            output, used = self.router.run_interactive(
                "rebuttal", messages, provider=provider,
                trace_id=trace_id, max_tokens=2000)
        else:
            output, used = self.router.run("rebuttal", messages,
                                           trace_id=trace_id, max_tokens=2000)
        provider = used
        invalid = validate_citations(output, citations)
        if invalid and provider != "offline":
            # 引用幻觉 → 重试一次，附加警告
            log_error(trace_id, "rebuttal_engine",
                      f"citation hallucination: {invalid}",
                      auto_fix="retry_with_warning")
            messages.append({"role": "assistant", "content": output})
            messages.append({"role": "user", "content":
                             f"你使用了不存在的引用 {invalid}，"
                             "请重写，只允许使用提供的引用 ID。"})
            if interactive:
                # 重试钉在刚才成功的槽上，不静默换槽
                output, provider = self.router.run_interactive(
                    "rebuttal", messages, provider=provider,
                    trace_id=trace_id, max_tokens=2000)
            else:
                output, provider = self.router.run("rebuttal", messages,
                                                   trace_id=trace_id,
                                                   max_tokens=2000)
            invalid = validate_citations(output, citations)
            if invalid:
                # 仍有幻觉 → 剥除无效引用
                for bad in invalid:
                    output = output.replace(f"[{bad}]", "")
                output += "\n\n（注：已自动移除无法溯源的引用）"

        used_ids = {f"C{m}" for m in _CITE_RE.findall(output)}
        refs = [c for c in citations if c["id"] in used_ids]

        # 反面演示风格：输出头部固定警示（决策 1）
        if get_styles().get(style, {}).get("demo_warning"):
            output = "⚠ 反面演示——这是错误示范\n\n" + output

        # 0.1.5 A1：中立评价存档——evaluate+不站队且生成成功，
        # 落 archive/中立评价/（frontmatter 含 stance: none，不回落首立场）
        neutral_archived = ""
        if (intent == "evaluate" and stance == "none"
                and output.strip() and provider != "offline"):
            try:
                from datetime import date as _date

                from ingestion.archiver import archive_neutral_review
                head = (argument.strip().splitlines()[0])[:40] or "评价"
                content = (f"---\ntitle: {head}\nstance: none\n"
                           f"archived_at: {_date.today().isoformat()}\n---\n\n"
                           f"# 评价：{argument.strip()[:200]}\n\n{output}")
                neutral_archived = archive_neutral_review(head, content)
            except Exception:   # 存档失败不阻断输出
                neutral_archived = ""

        # 字数检查：超目标 ±30% 仅提示不重生成（项目7）
        length_note = None
        if length:
            actual = len(re.sub(r"\s", "", output))
            if not 0.7 * length <= actual <= 1.3 * length:
                length_note = f"实际约 {actual} 字，与目标 {length} 字偏差超 30%"

        # 免费质量两维（项目8）：相关性来自检索链，利用率现算
        quality = {"context_relevance": r.get("context_relevance", 0.0),
                   "chunk_utilization": _char_overlap(
                       output, [c["text"] for c in citations])}

        return {"trace_id": trace_id, "rebuttal": output,
                "provider": provider, "stance": stance,
                "format": fmt, "style": style, "intent": intent,
                "neutral_archived": bool(neutral_archived),   # A1
                "parsed_argument": r["parsed_argument"],
                "detected_fallacies": fallacies,
                "length_note": length_note,
                "quality": quality,
                "citations": [{k: c[k] for k in
                               ("id", "author", "title", "year", "pages",
                                "chunk_id", "doc_id")} for c in refs],
                "citations_formatted": format_citations(refs, cite_format),
                "retrieved_chunks": len(citations),
                "retrieval_ms": r["retrieval_ms"]}

    def generate_stream(self, argument: str, stance: str,
                        fmt: str = "argument", style: str = "rebuttal",
                        trace_id: str | None = None,
                        length: int | None = None,
                        cite_format: str = "plain",
                        fallacy: bool = True,
                        mode: str = "hybrid",
                        center: str | None = None,
                        intent: str = "rebut",
                        materials: list[dict] | None = None,
                        provider: str | None = None,
                        interactive: bool = False
                        ) -> Generator[dict, None, None]:
        """SSE 流式：先推送 meta，再分片推送正文，最后推送 citations；
        0.1.5 H1：交互槽失败推 slot_failed 事件（不自动降级）。"""
        try:
            result = self.generate(argument, stance, fmt, style, trace_id,
                                   length=length, cite_format=cite_format,
                                   fallacy=fallacy, mode=mode, center=center,
                                   intent=intent, materials=materials,
                                   provider=provider, interactive=interactive)
        except SlotFailure as sf:
            yield {"event": "slot_failed",
                   "data": {"failed": sf.failed, "reason": sf.reason,
                            "next": sf.next}}
            return
        yield {"event": "meta",
               "data": {"trace_id": result["trace_id"],
                        "provider": result["provider"],
                        "stance": stance, "format": fmt, "style": style,
                        "detected_fallacies": result["detected_fallacies"]}}
        text = result["rebuttal"]
        step = 48
        for i in range(0, len(text), step):
            yield {"event": "delta", "data": {"text": text[i:i + step]}}
        yield {"event": "done",
               "data": {"citations": result["citations"],
                        "citations_formatted": result["citations_formatted"],
                        "quality": result["quality"],
                        "length_note": result["length_note"],
                        "neutral_archived": result["neutral_archived"],  # A1
                        "retrieval_ms": result["retrieval_ms"]}}
