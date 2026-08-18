"""跨立场综合报告（项目17）：同一论题 × N 立场检索链 + 大汇总调用。

流程：estimate()（跑前 token 预估提示）→ generate()：
逐立场 RetrievalChain 检索 → 结构化证据集 → 一次大汇总
（各立场核心论点/最强证据/相互攻击点/共识区）→ Markdown 可导出。
离线模式：不做汇总生成，仅输出各立场检索结果罗列（明确标注）。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from applog import new_trace_id
from engine.reranker import RetrievalChain
from models.model_router import ModelRouter, get_router
from storage.skill_loader import get_skill_loader

_REPORT_PROMPT = (
    "你是政治哲学研究助手。基于下方各立场的库内证据，就论题写一份中文综合报告，"
    "结构固定为四节 Markdown：\n"
    "## 各立场核心论点\n## 各立场最强证据\n## 相互攻击点\n## 共识区\n"
    "规则：只使用给出的证据，引用时标注[编号]；证据不足的立场如实说明；"
    "不替任何立场下最终裁决。\n\n论题：{topic}\n\n{evidence}")


class ReportEngine:
    def __init__(self, db, vec, router: ModelRouter | None = None):
        self.db = db
        self.vec = vec
        self.router = router or get_router()
        self.chain = RetrievalChain(db, vec, self.router)

    def available_stances(self) -> list[str]:
        """只报告有文档的立场（空立场跑了也是废话）。"""
        counts: dict[str, int] = {}
        for d in self.db.list_documents():
            s = d.get("stance") or ""
            counts[s] = counts.get(s, 0) + 1
        return [s for s in get_skill_loader().stances() if counts.get(s)]

    def estimate(self, topic: str, stances: list[str] | None = None) -> dict:
        """跑前预估：立场数 × 检索块 → 汇总调用 token 量级。"""
        stances = stances or self.available_stances()
        # 每立场约 Top-5 块 × ~500字 ≈ 1500 token；提示词 + 输出余量
        tokens = len(stances) * 1500 + 1200
        return {"stances": stances, "token_estimate": tokens,
                "llm_calls": len(stances) + 1}

    def generate(self, topic: str, stances: list[str] | None = None) -> dict:
        stances = stances or self.available_stances()
        if not stances:
            raise ValueError("知识库为空：没有任何立场有文档，无法生成报告")
        trace_id = new_trace_id()
        evidence_blocks: list[str] = []
        sections: list[dict] = []
        idx = 1
        for st in stances:
            r = self.chain.run(topic, st, trace_id=trace_id)
            chunks = r["chunks"][:5]
            cites = []
            for c in chunks:
                doc = self.db.get_document(c["doc_id"]) or {}
                cites.append({"n": idx, "chunk_id": c["chunk_id"],
                              "doc_title": doc.get("title") or c["doc_id"],
                              "text": c["text"][:400]})
                idx += 1
            sections.append({"stance": st, "citations": cites,
                             "context_relevance": r["context_relevance"]})
            evidence_blocks.append(
                f"### 立场：{st}\n" + ("\n".join(
                    f"[{c['n']}]（{c['doc_title']}）{c['text']}"
                    for c in cites) or "（该立场库内无相关证据）"))

        evidence = "\n\n".join(evidence_blocks)
        out, provider = self.router.run(
            "summarize",
            [{"role": "user",
              "content": _REPORT_PROMPT.format(topic=topic,
                                               evidence=evidence[:24000])}],
            trace_id=trace_id, max_tokens=2000, temperature=0.4)
        if provider == "offline":
            report_md = ("> 离线模式：未配置任何模型 Key，以下仅罗列各立场库内"
                         "检索结果，不做综合分析。\n\n" + evidence)
        else:
            report_md = out.strip()
        return {"topic": topic, "stances": stances, "provider": provider,
                "report_markdown": report_md, "sections": sections,
                "trace_id": trace_id}
