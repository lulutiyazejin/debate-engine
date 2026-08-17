"""Skill 文件加载器：解析 .skill.md 的段落结构，内存缓存，支持热重载。

两套 Skill：
- stances/   辩论立场（世界观/策略/检索偏好/Prompt模板）
- ingestion/ 文档入库分析规则
含基础 Prompt 注入检测（拦截常见注入短语）。
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"disregard\s+(all\s+)?prior",
    r"system\s*prompt\s*[:：]",
    r"你现在是(?!.*辩手)",  # "你现在是XXX"且非辩手角色定义
]


@dataclass
class Skill:
    name: str            # 文件名去后缀，如 liberal
    title: str           # 一级标题
    sections: dict[str, str] = field(default_factory=dict)  # 二级标题 → 内容
    path: Path | None = None

    def get(self, section: str, default: str = "") -> str:
        return self.sections.get(section, default)

    @property
    def prompt_template(self) -> str:
        return self.get("Prompt 模板") or self.get("Prompt模板")

    @property
    def retrieval_prefs(self) -> dict[str, list[str]]:
        """解析'知识库检索偏好'：优先/交叉/排除 目录列表。"""
        text = self.get("知识库检索偏好")
        prefs = {"prefer": [], "cross": [], "exclude": []}
        for line in text.splitlines():
            m = re.search(r"stances/(\w+)", line)
            if not m:
                continue
            stance = m.group(1)
            if "优先" in line:
                prefs["prefer"].append(stance)
            elif "交叉" in line:
                prefs["cross"].append(stance)
            elif "排除" in line:
                prefs["exclude"].append(stance)
        return prefs


def _check_injection(text: str) -> list[str]:
    hits = []
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            hits.append(pat)
    return hits


def parse_skill_md(path: Path) -> Skill:
    text = path.read_text(encoding="utf-8")
    title_m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    title = title_m.group(1).strip() if title_m else path.stem
    sections: dict[str, str] = {}
    cur: str | None = None
    buf: list[str] = []
    for line in text.splitlines():
        h2 = re.match(r"^##\s+(.+)$", line)
        if h2:
            if cur:
                sections[cur] = "\n".join(buf).strip()
            cur = h2.group(1).strip()
            buf = []
        elif cur:
            buf.append(line)
    if cur:
        sections[cur] = "\n".join(buf).strip()
    return Skill(name=path.stem.replace(".skill", ""), title=title,
                 sections=sections, path=path)


class SkillLoader:
    def __init__(self, skills_root: Path | None = None):
        self.root = skills_root or config.SKILLS_PATH
        self._cache: dict[str, dict[str, Skill]] = {}

    def _load_dir(self, kind: str) -> dict[str, Skill]:
        d = self.root / kind
        out: dict[str, Skill] = {}
        if not d.exists():
            return out
        for p in sorted(d.glob("*.skill.md")):
            try:
                text = p.read_text(encoding="utf-8")
                if _check_injection(text):
                    continue  # 含注入语句的 Skill 拒绝加载
                out[p.stem.replace(".skill", "")] = parse_skill_md(p)
            except Exception:
                continue
        return out

    def stances(self, reload: bool = False) -> dict[str, Skill]:
        if reload or "stances" not in self._cache:
            self._cache["stances"] = self._load_dir("stances")
        return self._cache["stances"]

    def ingestion(self, reload: bool = False) -> dict[str, Skill]:
        if reload or "ingestion" not in self._cache:
            self._cache["ingestion"] = self._load_dir("ingestion")
        return self._cache["ingestion"]

    def get_stance(self, name: str) -> Skill | None:
        return self.stances().get(name)

    def get_ingestion(self, name: str) -> Skill | None:
        return self.ingestion().get(name) or self.ingestion().get("default")


_loader: SkillLoader | None = None


def get_skill_loader() -> SkillLoader:
    global _loader
    if _loader is None:
        _loader = SkillLoader()
    return _loader
