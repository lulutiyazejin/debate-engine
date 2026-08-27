"""Skill 模板迁移器（0.1.9 R1）：升级时对照内置模板，用户 skill 文件缺失的
`## 小节` 自动追加，已有小节原样不动。

通用机制——今后新增内置项（新风格、17 轴合并表等历史新增）只需登记到
`_DEFAULT_SECTIONS` 即可随升级自动下发；不触碰用户自定义行。

背景：NSIS 安装脚本对 skills 目录用 SetOverwrite off 保护用户改动，
导致老用户升级后拿不到新内置项（如 0.1.9「日常」风格）。本迁移器在启动时补齐。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from applog import log_system

# 内置默认小节登记表：{文件名: {小节键: (显示名, 正文)}}
# 追加块渲染为 `## 键 显示名\n正文\n`；键已存在于用户文件时跳过。
_DEFAULT_SECTIONS: dict[str, dict[str, tuple[str, str]]] = {
    "styles.md": {
        "daily": (
            "日常",
            "日常口语：像跟朋友聊天一样说人话，短句、少术语、不堆砌名词；\n"
            "把复杂道理拆成大白话，能举生活化例子就举，读起来轻松不端着。",
        ),
    },
}


def _existing_keys(text: str) -> set[str]:
    """收集文件内所有 `## 键 ...` 的键名（首个空白前的 token）。"""
    return {m.group(1) for m in re.finditer(r"^##\s+(\S+)", text, re.MULTILINE)}


def migrate_skill_file(path: Path, sections: dict[str, tuple[str, str]]) -> list[str]:
    """对单个 skill 文件补齐缺失小节，返回追加的小节键列表。

    文件不存在则跳过（新装由安装包铺全量模板，无需迁移）。"""
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    have = _existing_keys(text)
    appended: list[str] = []
    blocks: list[str] = []
    for key, (label, body) in sections.items():
        if key in have:
            continue  # 已有小节（含用户改过的）原样不动
        blocks.append(f"\n## {key} {label}\n{body}\n")
        appended.append(key)
    if blocks:
        if not text.endswith("\n"):
            text += "\n"
        path.write_text(text + "".join(blocks), encoding="utf-8")
    return appended


def migrate_skills(skills_root: Path) -> None:
    """启动钩子：遍历默认登记表逐文件补齐；异常不阻断启动。"""
    for fname, sections in _DEFAULT_SECTIONS.items():
        try:
            appended = migrate_skill_file(skills_root / fname, sections)
            if appended:
                log_system("skill_migrated", file=fname, added=",".join(appended))
        except Exception as e:  # noqa: BLE001 迁移失败不影响服务启动
            log_system("skill_migrate_error", file=fname, error=str(e))
