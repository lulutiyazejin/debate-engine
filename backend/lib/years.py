# backend/lib/years.py – 年份解析与收敛函数（0.1.9 D1）


def is_int_year(v: str) -> bool:
    """纯 4 位整数年"""
    return len(v.strip()) == 4 and v.isdigit()


def parse_iso_date(s: str):
    """
    YYYY-MM-DD[ HH:MM:SS] 解析器，返回 (year, year_raw) 或 (None, None)。
    兼容：2026-05-01 / 2026-05 / 2026 / 2026-05-01 12:01:37 / 2026-05-01T12:01:37
    逐段校验月日时分秒合法性（参考后端 parser 风格），失败则 None。
    """
    s = s.strip()
    if not s:
        return None, None
    # 紧凑数字尝试（先试 ISO，再试紧凑）
    compact_formats = [
        (r"^\d{14}$", "14"),
        (r"^\d{12}$", "12"),
        (r"^\d{8}$", "8"),
    ]
    for pattern, fmt in compact_formats:
        import re as _re
        m = _re.match(pattern, s)
        if m:
            if fmt == "14":
                y, mo, d, hh, mi, ss = int(s[:4]), int(s[4:6]), int(s[6:8]), \
                                        int(s[8:10]), int(s[10:12]), int(s[12:14])
            elif fmt == "12":
                y, mo, d, hh, mi = int(s[:4]), int(s[4:6]), int(s[6:8]), \
                                   int(s[8:10]), int(s[10:12])
                ss = None
            else:  # 8
                y, mo, d = int(s[:4]), int(s[4:6]), int(s[6:8])
                hh, mi, ss = None, None, None
            # 逐段校验
            if not (1 <= mo <= 12):
                return None, None
            if not (1 <= d <= 31):
                return None, None
            if hh is not None and not (0 <= hh <= 23):
                return None, None
            if mi is not None and not (0 <= mi <= 59):
                return None, None
            if ss is not None and not (0 <= ss <= 59):
                return None, None
            return y, s
    # ISO 模式尝试
    iso_patterns = [
        r"^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$",
        r"^(\d{4})-(\d{2})-(\d{2})$|^(\d{4})-(\d{2})$",
    ]
    for pat in iso_patterns:
        m = _re.match(pat, s)
        if m:
            groups = m.groups()
            y = int(groups[0])
            mo, d = int(groups[1]), int(groups[2])
            hh = int(groups[3]) if groups[3] else None
            mi = int(groups[4]) if groups[4] else None
            ss = int(groups[5]) if groups[5] else None
            if not (1 <= mo <= 12) or not (1 <= d <= 31):
                continue
            if hh is not None and not (0 <= hh <= 23):
                continue
            if mi is not None and not (0 <= mi <= 59):
                continue
            if ss is not None and not (0 <= ss <= 59):
                continue
            # 归一化原文：YYYY-MM-DD[ HH:MM:SS]
            yr = f"{y}-{mo:02d}-{d:02d}"
            if hh is not None and mi is not None:
                sec = f"{ss:02d}" if ss is not None else "00"
                yr += f" {hh:02d}:{mi:02d}:{sec}"
            return y, yr
    return None, None


def clamp_to_valid_year(y: int) -> bool:
    """合理年份区间 -3000..2600 判定"""
    return -3000 <= y <= 2600


def sane_year(v: object | None) -> tuple[int | None, str | None]:
    """
    统一年份解析器：输入任意类型，输出 (year_int, year_raw)；失败均为 None。
    识别格式优先级：
      1) ISO 字符串 + 紧凑时间戳（8/12/14 位逐段校验）
      2) 4 位纯整数 → year_raw 原样返回字符串
      3) 其他 → None,None
    约束：parsed.year 必须在 -3000..2600 内，否则 None。
    用途：parsers.py（导入解析）/web_enrich（若有）/knowledge.py PATCH 三写点共用。
    """
    if v is None:
        return None, None
    s = str(v).strip()
    if not s:
        return None, None
    # 先尝试 ISO + 紧凑（自动带原文）
    y, yr = parse_iso_date(s)
    if y is not None and clamp_to_valid_year(y):
        return y, yr
    # 再试 4 位整数年
    if len(s) == 4 and s.isdigit():
        yi = int(s)
        if clamp_to_valid_year(yi):
            return yi, s
    return None, None
