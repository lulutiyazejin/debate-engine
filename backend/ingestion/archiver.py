"""档案库（0.1.4 批 6 决策 5/6）：入库确认后把文档归档为人可读 md + 原件。

目录结构：knowledge_base/archive/{立场}/{作者}/{标题}.md（+ 同名原件）
- 转换分档 frontmatter：source_format + conversion: full/lossy/summary-only
- 撞名：版次 → 出版年 → 序号 递进消歧
- 策略 policy：copy=复制原件 / move=迁移原件 / none=不归档
- AI 链路维持内存提取，md 只作归档副产物（决策 5）
- .archive_index.json 记 doc_id → 相对路径，支撑改立场移动/删除级联
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

ARCHIVE_PATH = config.KNOWLEDGE_BASE_PATH / "archive"
_INDEX = ARCHIVE_PATH / ".archive_index.json"

_FULL = {".txt", ".md", ".markdown", ".docx", ".html", ".htm", ".csv"}
_LOSSY = {".doc"}


def classify_conversion(source: str, source_type: str, full_text: str) -> tuple[str, str]:
    """返回 (source_format, conversion)。
    干净全文=txt/md/docx/URL → full；文字层 PDF/.doc → lossy；
    扫描 PDF / xlsx / 图表 PDF → summary-only（只元数据+摘要）。"""
    if source_type == "url":
        return "url", "full"
    ext = Path(source).suffix.lower()
    fmt = ext.lstrip(".") or "unknown"
    if ext in _FULL:
        return fmt, "full"
    if ext in _LOSSY:
        return fmt, "lossy"
    if ext in {".xlsx", ".xls"}:
        return fmt, "summary-only"
    if ext == ".pdf":
        # 文字层过薄按扫描件处理（OCR 未装时只归档摘要）
        return fmt, ("lossy" if len((full_text or "").strip()) > 200
                     else "summary-only")
    return fmt, "summary-only"


def _safe(seg: str) -> str:
    """路径段消毒：Windows 保留字符替换，首尾空白/点去除。"""
    seg = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", (seg or "").strip()).strip(". ")
    return seg[:80] or "未命名"


def _load_index() -> dict:
    try:
        return json.loads(_INDEX.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_index(data: dict) -> None:
    _INDEX.parent.mkdir(parents=True, exist_ok=True)
    _INDEX.write_text(json.dumps(data, ensure_ascii=False, indent=1),
                      encoding="utf-8")


def _unique_stem(d: Path, title: str, edition: str | None,
                 year: str | int | None) -> str:
    """撞名消歧：标题 → +版次 → +出版年 → +序号。"""
    base = _safe(title)
    candidates = [base]
    if edition:
        candidates.append(f"{base}（{_safe(str(edition))}）")
    if year:
        candidates.append(f"{base}（{year}）")
    for cand in candidates:
        if not (d / f"{cand}.md").exists():
            return cand
    n = 2
    while (d / f"{base}（{n}）.md").exists():
        n += 1
    return f"{base}（{n}）"


def archive_document(doc_id: str, title: str, author: str | None,
                     year: str | int | None, stance: str, source: str,
                     source_type: str, full_text: str, summary: str,
                     policy: str = "copy",
                     edition: str | None = None) -> dict:
    """入库归档主入口。policy: copy/move/none。返回 {md, original, conversion}。"""
    if policy == "none":
        return {"md": None, "original": None, "conversion": None}
    fmt, conversion = classify_conversion(source, source_type, full_text)
    d = ARCHIVE_PATH / _safe(stance or "unknown") / _safe(author or "未知作者")
    d.mkdir(parents=True, exist_ok=True)
    stem = _unique_stem(d, title, edition, year)

    fm = ["---", f"doc_id: {doc_id}", f"title: {title}",
          f"author: {author or '未知作者'}", f"year: {year or ''}",
          f"stance: {stance}", f"source_format: {fmt}",
          f"conversion: {conversion}",
          f"archived_at: {date.today().isoformat()}", "---", ""]
    if conversion == "summary-only":
        body = ["# 摘要", "", summary or "（无摘要）", "",
                "> 原格式不适合全文转写（扫描件/表格类），此档只含元数据与摘要；"
                "原件见同目录。"]
    else:
        body = [full_text or summary or "（空）"]
        if conversion == "lossy":
            body.insert(0, "> 有噪转换（自动提取，可能丢失版式/图表）。\n")
    md_path = d / f"{stem}.md"
    md_path.write_text("\n".join(fm + body) + "\n", encoding="utf-8")

    original = None
    src = Path(source)
    if source_type != "url" and src.exists() and src.is_file():
        dst = d / f"{stem}{src.suffix.lower()}"
        if not dst.exists():
            if policy == "move":
                shutil.move(str(src), str(dst))
            else:
                shutil.copy2(src, dst)
        original = str(dst)

    idx = _load_index()
    rels = [str(md_path.relative_to(ARCHIVE_PATH))]
    if original:
        rels.append(str(Path(original).relative_to(ARCHIVE_PATH)))
    idx[doc_id] = rels
    _save_index(idx)
    return {"md": str(md_path), "original": original, "conversion": conversion}


def archive_neutral_review(title: str, content: str) -> str:
    """决策 14：中立评价存档进 archive/中立评价/，不回落首立场。"""
    d = ARCHIVE_PATH / "中立评价"
    d.mkdir(parents=True, exist_ok=True)
    stem = _unique_stem(d, title, None, None)
    p = d / f"{stem}.md"
    p.write_text(content, encoding="utf-8")
    return str(p)


def move_archive(doc_id: str, new_stance: str) -> list[str]:
    """改立场第七处同步：档案移到新立场目录（保留作者层）。"""
    idx = _load_index()
    rels = idx.get(doc_id) or []
    moved: list[str] = []
    new_rels: list[str] = []
    for rel in rels:
        p = ARCHIVE_PATH / rel
        if not p.exists():
            continue
        parts = Path(rel).parts             # (立场, 作者, 文件名)
        author = parts[1] if len(parts) >= 3 else "未知作者"
        nd = ARCHIVE_PATH / _safe(new_stance) / author
        nd.mkdir(parents=True, exist_ok=True)
        target = nd / p.name
        if target != p:
            if p.suffix == ".md":
                text = re.sub(r"^stance: .*$", f"stance: {new_stance}",
                              p.read_text(encoding="utf-8"), count=1,
                              flags=re.MULTILINE)
                target.write_text(text, encoding="utf-8")
                p.unlink()
            else:
                shutil.move(str(p), str(target))
            moved.append(str(target))
        new_rels.append(str(target.relative_to(ARCHIVE_PATH)))
    if rels:
        idx[doc_id] = new_rels
        _save_index(idx)
    return moved


def delete_archive(doc_id: str) -> int:
    """删文档可选级联：默认保留档案，显式调用才删。"""
    idx = _load_index()
    n = 0
    for rel in idx.pop(doc_id, []):
        p = ARCHIVE_PATH / rel
        if p.exists():
            p.unlink()
            n += 1
    _save_index(idx)
    return n


def archive_paths(doc_id: str) -> list[str]:
    return [str(ARCHIVE_PATH / rel) for rel in _load_index().get(doc_id, [])
            if (ARCHIVE_PATH / rel).exists()]
