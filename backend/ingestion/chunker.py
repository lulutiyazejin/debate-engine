"""文本分块器：按文档结构切割，语义完整，单块 ≤ 8K tokens。

优先级：章节边界（parser 已按书签/标题切好 Section）→ 超长章节按段落细分
→ 固定硬切（最后手段）。短文章（< 2K tokens）不切割整体一块。
参考文献/索引/目录等已在 parser 层过滤。
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from ingestion.parsers import ParsedDocument, Section


@dataclass
class Chunk:
    text: str
    chapter_title: str
    chapter_num: int
    page_range: str = ""
    token_count: int = 0
    meta: dict = field(default_factory=dict)


def estimate_tokens(text: str) -> int:
    """粗略 token 估算：中文字符 1 token/字，英文按词 ×1.3。"""
    cjk = len(re.findall(r"[\u4e00-\u9fff\u3000-\u303f]", text))
    words = len(re.findall(r"[a-zA-Z0-9]+", text))
    return cjk + int(words * 1.3)


def _split_paragraphs(text: str) -> list[str]:
    paras = re.split(r"\n\s*\n", text)
    return [p.strip() for p in paras if p.strip()]


def _hard_split(text: str, max_tokens: int) -> list[str]:
    """最后手段：按句号边界硬切，保证不超限。"""
    sentences = re.split(r"(?<=[。！？.!?\n])", text)
    out, buf, size = [], [], 0
    for s in sentences:
        t = estimate_tokens(s)
        if size + t > max_tokens and buf:
            out.append("".join(buf).strip())
            buf, size = [], 0
        buf.append(s)
        size += t
    if buf and "".join(buf).strip():
        out.append("".join(buf).strip())
    return out


def _split_section(sec: Section, max_tokens: int) -> list[str]:
    """超长章节：先按段落聚合切分，单段仍超限时硬切。"""
    pieces: list[str] = []
    buf: list[str] = []
    size = 0
    for para in _split_paragraphs(sec.text):
        t = estimate_tokens(para)
        if t > max_tokens:                      # 单段超限 → 硬切
            if buf:
                pieces.append("\n\n".join(buf))
                buf, size = [], 0
            pieces.extend(_hard_split(para, max_tokens))
            continue
        if size + t > max_tokens and buf:
            pieces.append("\n\n".join(buf))
            buf, size = [], 0
        buf.append(para)
        size += t
    if buf:
        pieces.append("\n\n".join(buf))
    return pieces


def chunk_document(doc: ParsedDocument,
                   max_tokens: int = config.CHUNK_MAX_TOKENS,
                   short_doc_tokens: int = config.SHORT_DOC_TOKENS) -> list[Chunk]:
    """ParsedDocument → Chunk 列表。"""
    full = doc.full_text
    total = estimate_tokens(full)
    if total <= short_doc_tokens and full.strip():
        # 短文章：整体一块
        return [Chunk(text=full.strip(), chapter_title=doc.title,
                      chapter_num=1, token_count=total,
                      page_range=doc.sections[0].page_range if doc.sections else "")]

    chunks: list[Chunk] = []
    for num, sec in enumerate(doc.sections, start=1):
        if not sec.text.strip():
            continue
        t = estimate_tokens(sec.text)
        if t <= max_tokens:
            chunks.append(Chunk(text=sec.text.strip(), chapter_title=sec.title,
                                chapter_num=num, page_range=sec.page_range,
                                token_count=t))
        else:
            for i, piece in enumerate(_split_section(sec, max_tokens), start=1):
                chunks.append(Chunk(
                    text=piece, chapter_title=f"{sec.title}（{i}）",
                    chapter_num=num, page_range=sec.page_range,
                    token_count=estimate_tokens(piece)))
    return chunks
