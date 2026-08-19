"""0.1.4 批 3（决策 16-C）：给非马克思主义族预置立场追加笔法黑名单机读行。

在「## 禁止使用的论证方式」节末追加 `method_blacklist: dialectical, immanent`
（唯物辩证法/内在批判为马克思主义族方法论，非马族立场下世界观自相矛盾）。
马族（marxist / chinese_socialism）不加；已含机读行的文件跳过（幂等）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STANCES = ROOT / "knowledge_base" / "skills" / "stances"
MARXIST_FAMILY = {"marxist", "chinese_socialism"}
LINE = "method_blacklist: dialectical, immanent"
SECTION = "## 禁止使用的论证方式"


def main() -> None:
    changed = []
    for p in sorted(STANCES.glob("*.skill.md")):
        name = p.stem.replace(".skill", "")
        if name in MARXIST_FAMILY:
            continue
        text = p.read_text(encoding="utf-8")
        if "method_blacklist:" in text:
            continue
        lines = text.splitlines()
        out: list[str] = []
        in_sec = False
        inserted = False
        for ln in lines:
            if ln.startswith("## "):
                if in_sec and not inserted:      # 节结束处插入
                    out.append(LINE)
                    out.append("")
                    inserted = True
                in_sec = ln.strip() == SECTION
            out.append(ln)
        if in_sec and not inserted:              # 该节在文件末尾
            out.append(LINE)
            inserted = True
        if inserted:
            p.write_text("\n".join(out) + "\n", encoding="utf-8")
            changed.append(name)
    print("blacklist added:", ", ".join(changed) or "(none)")


if __name__ == "__main__":
    main()
