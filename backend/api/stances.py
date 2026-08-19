"""立场接口：GET /api/stances（已配置立场 + 文档统计）
+ 0.1.3 B8 立场管理：skill md 导入（校验不静默）/ 删除 / 模板下载。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from api.deps import get_db
from storage.skill_loader import _check_injection, get_skill_loader

router = APIRouter(prefix="/api", tags=["stances"])

# 界面显示的中文名剥掉 SKILL: 前缀（决策 B8）
_TITLE_PREFIX = re.compile(r"^SKILL[:：]\s*")


def _display_title(title: str) -> str:
    return _TITLE_PREFIX.sub("", title).strip()


@router.get("/stances")
def list_stances():
    loader = get_skill_loader()
    db = get_db()
    docs = db.list_documents()
    counts: dict[str, int] = {}
    for d in docs:
        s = d.get("stance") or "unknown"
        counts[s] = counts.get(s, 0) + 1
    out = []
    for name, skill in loader.stances(reload=True).items():
        out.append({"name": name, "title": _display_title(skill.title),
                    "default_style": skill.get("默认回复风格", "反驳"),
                    "doc_count": counts.get(name, 0),
                    "builtin": name in _BUILTIN_STANCES,
                    "retrieval_prefs": skill.retrieval_prefs})
    return {"stances": out, "total_docs": len(docs)}


# ---------- 0.1.3 B8：立场管理（导入校验逐条报错，不静默拒载） ----------

_REQUIRED_SECTIONS = ("世界观假设", "反驳策略偏好", "禁止使用的论证方式",
                      "知识库检索偏好", "默认回复风格", "Prompt 模板")
# 预置立场不可删（随包分发，删了重装才能回来）
_BUILTIN_STANCES = {
    "liberal", "marxist", "conservative", "empirical", "social_democracy",
    "neoliberal", "feudal_traditional", "chinese_socialism", "communitarian",
    "anarchist", "fascist", "environmentalist", "feminist", "nationalist",
    "populist", "technocrat", "keynesian"}


class StanceImport(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=10, max_length=100_000)


def validate_stance_md(name: str, content: str) -> list[str]:
    """导入校验（B8）：返回错误清单，空 = 通过。规则与 STANCE-TEMPLATE 一致。"""
    errors: list[str] = []
    if not re.fullmatch(r"[A-Za-z0-9_]+", name):
        errors.append("文件名（立场 id）只能包含英文/数字/下划线")
    if not re.search(r"^#\s+SKILL[:：]\s*\S", content, re.MULTILINE):
        errors.append("第一行须为一级标题 `# SKILL: <中文立场名>立场`")
    for sec in _REQUIRED_SECTIONS:
        if not re.search(rf"^##\s+{re.escape(sec)}\s*$", content, re.MULTILINE):
            errors.append(f"缺少必需小节 `## {sec}`（须逐字一致）")
    hits = _check_injection(content)
    if hits:
        errors.append(f"命中 Prompt 注入检测（{len(hits)} 处），拒绝导入")
    return errors


@router.post("/stances/import")
def import_stance(req: StanceImport):
    """skill md 上传 → 校验 → 落 skills/stances/ → loader 热加载。"""
    errors = validate_stance_md(req.name, req.content)
    if errors:
        raise HTTPException(422, "；".join(errors))
    dest = config.SKILLS_PATH / "stances" / f"{req.name}.skill.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(req.content, encoding="utf-8")
    loader = get_skill_loader()
    stances = loader.stances(reload=True)
    if req.name not in stances:
        dest.unlink(missing_ok=True)   # 落盘后仍没被加载 = 解析失败，回滚
        loader.stances(reload=True)
        raise HTTPException(422, "文件已写入但加载器无法解析，已回滚；请对照模板检查格式")
    return {"ok": True, "name": req.name,
            "title": _display_title(stances[req.name].title)}


@router.delete("/stances/{name}")
def delete_stance(name: str):
    """删除手动导入的立场（预置立场保护不可删）。"""
    if name in _BUILTIN_STANCES:
        raise HTTPException(422, f"{name} 是随包预置立场，不可删除")
    p = config.SKILLS_PATH / "stances" / f"{name}.skill.md"
    if not p.exists():
        raise HTTPException(404, f"立场 {name} 不存在")
    p.unlink()
    get_skill_loader().stances(reload=True)
    return {"ok": True, "name": name}


@router.get("/stances/template")
def stance_template():
    """导入模板全文（设置页「立场管理」提供下载/复制）。"""
    p = config.SKILLS_PATH / "STANCE-TEMPLATE.md"
    if not p.exists():
        p = config.PROJECT_ROOT / "knowledge_base" / "skills" / "STANCE-TEMPLATE.md"
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    return {"template": text}
