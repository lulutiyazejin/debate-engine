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
        result = {"topic": topic, "stances": stances, "provider": provider,
                  "report_markdown": report_md, "sections": sections,
                  "trace_id": trace_id}
        result["report_html"] = render_html(result)
        return result


# ---------- 整页 HTML 渲染（项目22：纸感浅色、纯内联零 CDN，断网可开） ----------

_HTML_SHELL = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ color-scheme: light; }}
body {{ margin:0; background:#f5f3ee; color:#25231f;
  font:15px/1.7 "Source Han Serif SC","Noto Serif SC",Georgia,serif; }}
.page {{ max-width:72ch; margin:0 auto; padding:48px 24px 96px; }}
header.report {{ border-bottom:1px solid rgba(37,35,31,.25);
  padding-bottom:24px; margin-bottom:40px; }}
h1 {{ font-size:24px; margin:0 0 16px; letter-spacing:.02em; }}
.stats {{ display:flex; gap:40px; margin-top:16px; }}
.stat b {{ display:block; font-size:32px; line-height:1.1;
  font-variant-numeric:tabular-nums; }}
.stat span {{ font-size:12px; color:#6f6a60; }}
h2 {{ font-size:18px; margin:40px 0 12px; padding-top:16px;
  border-top:1px solid rgba(37,35,31,.12); }}
h3 {{ font-size:15px; margin:24px 0 8px; }}
p {{ margin:0 0 12px; }}
blockquote {{ margin:0 0 16px; padding:8px 16px; background:#ece8df;
  border-left:2px solid #8a2422; font-size:13px; }}
.cite {{ font-size:12px; color:#6f6a60; vertical-align:super; }}
footer.report {{ margin-top:56px; padding-top:16px;
  border-top:1px solid rgba(37,35,31,.25); font-size:12px; color:#6f6a60; }}
footer.report li {{ margin-bottom:4px; }}
</style></head><body><div class="page">
<header class="report"><h1>{title}</h1>
<div class="stats">
<div class="stat"><b>{n_stances}</b><span>参与立场</span></div>
<div class="stat"><b>{n_cites}</b><span>库内证据</span></div>
<div class="stat"><b>{provider}</b><span>生成来源</span></div>
</div></header>
{body}
<footer class="report"><strong>证据来源（库内可溯源）</strong><ol>
{sources}</ol>
<p>Debate Engine 综合报告 · 所有编号引用均来自本地知识库</p></footer>
</div></body></html>"""


def _md_to_html(md: str) -> str:
    """最小 Markdown→HTML（标题/引用块/段落/引用编号上标），零依赖。"""
    import html as _h
    import re as _re
    out = []
    for block in md.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        lines = block.split("\n")
        if all(ln.startswith(">") for ln in lines):
            text = _h.escape(" ".join(ln.lstrip("> ") for ln in lines))
            out.append(f"<blockquote>{text}</blockquote>")
            continue
        for ln in lines:
            if ln.startswith("### "):
                out.append(f"<h3>{_h.escape(ln[4:])}</h3>")
            elif ln.startswith("## "):
                out.append(f"<h2>{_h.escape(ln[3:])}</h2>")
            elif ln.startswith("# "):
                out.append(f"<h2>{_h.escape(ln[2:])}</h2>")
            else:
                t = _re.sub(r"\[(\d+)\]", r'<span class="cite">[\1]</span>',
                            _h.escape(ln))
                out.append(f"<p>{t}</p>")
    return "\n".join(out)


def render_html(result: dict) -> str:
    """报告 dict → 单文件纸感 HTML（项目22）。"""
    import html as _h
    cites = [c for s in result.get("sections", [])
             for c in s.get("citations", [])]
    sources = "\n".join(
        f"<li value=\"{c['n']}\">{_h.escape(str(c['doc_title']))}"
        f"（{_h.escape(str(c['chunk_id']))}）</li>" for c in cites)
    return _HTML_SHELL.format(
        title=_h.escape(f"综合报告：{result['topic']}"),
        n_stances=len(result.get("stances", [])),
        n_cites=len(cites),
        provider=_h.escape(str(result.get("provider") or "—")),
        body=_md_to_html(result.get("report_markdown") or ""),
        sources=sources or "<li>（离线模式：见正文罗列）</li>")
