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
from applog import log_error, new_trace_id
from engine.reranker import RetrievalChain
from models.model_router import ModelRouter, get_router
from storage.skill_loader import get_skill_loader
from storage.sqlite_store import SqliteStore

FORMATS = {
    "quick": "速辩：3 句话以内，直击要害，使用 1-2 个引用",
    "argument": "论证：结构化段落（复述对方论点→指出漏洞→展开反驳→结论），完整论证链",
    "report": "报告：学术格式，分节论述，结尾附完整参考文献列表",
}

STYLES = {
    "rebuttal": "反驳（正面驳斥）", "critique": "批判性分析",
    "socratic": "苏格拉底式提问", "steelman": "先钢人再反驳",
    "data": "数据实证导向", "historical": "历史案例导向",
    "concise": "极简犀利", "formal": "正式书面",
}

_CITE_RE = re.compile(r"\[C(\d+)\]")


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


def build_prompt(argument: str, parsed: dict, citations: list[dict],
                 stance: str, fmt: str, style: str) -> list[dict]:
    skill = get_skill_loader().get_stance(stance)
    sys_prompt = (skill.prompt_template if skill else
                  "你是一名理性辩手，基于提供的资料反驳对方论点。")
    sys_prompt += (f"\n\n输出要求：{FORMATS.get(fmt, FORMATS['argument'])}；"
                   f"风格：{STYLES.get(style, style)}。\n"
                   "引用规则：只能使用下方资料的引用 ID（如 [C1]），"
                   "严禁编造任何未提供的作者、书名或数据。")
    lines = [f"对方论点：{argument}", "",
             f"论点解析：核心主张={parsed['core_claim']}；"
             f"薄弱环节={'、'.join(parsed['attack_surface'][:3])}", "",
             f"可用资料（{len(citations)}条）："]
    for c in citations:
        head = f"[{c['id']}] {c['author']}《{c['title']}》"
        if c["year"]:
            head += f"({c['year']})"
        if c["pages"]:
            head += f" {c['pages']}"
        lines.append(f"{head}：{c['text'][:800]}")
    lines += ["", "请生成反驳，引用只能使用以上资料的 [C编号]。"]
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

    def generate(self, argument: str, stance: str, fmt: str = "argument",
                 style: str = "rebuttal",
                 trace_id: str | None = None) -> dict:
        """完整链路：检索 → 组装 → 生成 → 引用验证（失败重试一次）。"""
        trace_id = trace_id or new_trace_id()
        r = self.chain.run(argument, stance, style=style, trace_id=trace_id)
        citations = build_citations(r["chunks"], self.db)
        messages = build_prompt(argument, r["parsed_argument"], citations,
                                stance, fmt, style)

        output, provider = self.router.run("rebuttal", messages,
                                           trace_id=trace_id, max_tokens=2000)
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
        return {"trace_id": trace_id, "rebuttal": output,
                "provider": provider, "stance": stance,
                "format": fmt, "style": style,
                "parsed_argument": r["parsed_argument"],
                "citations": [{k: c[k] for k in
                               ("id", "author", "title", "year", "pages",
                                "chunk_id", "doc_id")} for c in refs],
                "retrieved_chunks": len(citations),
                "retrieval_ms": r["retrieval_ms"]}

    def generate_stream(self, argument: str, stance: str,
                        fmt: str = "argument", style: str = "rebuttal",
                        trace_id: str | None = None
                        ) -> Generator[dict, None, None]:
        """SSE 流式：先推送 meta，再分片推送正文，最后推送 citations。"""
        result = self.generate(argument, stance, fmt, style, trace_id)
        yield {"event": "meta",
               "data": {"trace_id": result["trace_id"],
                        "provider": result["provider"],
                        "stance": stance, "format": fmt, "style": style}}
        text = result["rebuttal"]
        step = 48
        for i in range(0, len(text), step):
            yield {"event": "delta", "data": {"text": text[i:i + step]}}
        yield {"event": "done",
               "data": {"citations": result["citations"],
                        "retrieval_ms": result["retrieval_ms"]}}
