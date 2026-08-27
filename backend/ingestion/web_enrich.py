"""联网元数据补充（0.1.3 B4）：维基百科(中→英) → 百度百科 → 必应摘要。

规则（PLAN 决策10）：
- 每级超时 3 秒，失败自动降级下一级，全失败返回空字段 + 显式失败报告
- 只补不盖：调用方负责跳过 manual_fields 与已有值
- 走 config 代理三态；SSL 审查环境降级重试复用 llm_client 同款策略
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

_TIMEOUT = 3.0

# 学派关键词表（A2 学派参考表的机器可读子集：命中即归类，匹配不上留空）
_SCHOOLS = [
    "经验主义", "理性主义", "实用主义", "实证主义", "现象学", "存在主义",
    "分析哲学", "解释学", "法兰克福学派", "批判理论",
    "自由主义", "保守主义", "马克思主义", "社会民主主义", "自由意志主义",
    "社群主义", "共和主义", "无政府主义", "女权主义", "民族主义",
    "奥地利学派", "芝加哥学派", "凯恩斯主义", "货币主义", "制度经济学",
    "行为经济学", "重农学派", "重商主义", "古典经济学", "新古典经济学",
    "功能主义", "冲突论", "符号互动论", "结构主义", "后结构主义",
    "年鉴学派", "剑桥学派", "兰克学派",
]

_YEARS_RE = re.compile(r"(1[0-9]{3}|20[0-2][0-9])\s*[年]?\s*[-–—~至]\s*"
                       r"(1[0-9]{3}|20[0-2][0-9]|今|至今)?")

# 0.1.5 A3：版次补抓（中文「第N版」/ 英文 Nth edition）
_EDITION_RE = re.compile(
    r"(第\s*[一二三四五六七八九十百0-9]+\s*版|\b\d+(?:st|nd|rd|th)\s+edition)", re.I)


def _get(url: str) -> httpx.Response:
    """带代理三态 + SSL 降级的 GET（3 秒超时）。"""
    kw = {"timeout": _TIMEOUT, "follow_redirects": True,
          "proxy": config.httpx_proxy_for(url),
          "trust_env": config.httpx_trust_env_for(url),
          "headers": {"User-Agent": "Mozilla/5.0 DebateEngine/0.1.3"}}
    try:
        return httpx.get(url, **kw)
    except httpx.ConnectError as e:
        if "SSL" in str(e) or "CERTIFICATE" in str(e).upper():
            return httpx.get(url, verify=False, **kw)
        raise


def _extract_fields(text: str) -> dict:
    """从摘要文本抽 生卒年/学派/版次（正则 + 关键词，抽不到留空）。"""
    out: dict = {}
    m = _YEARS_RE.search(text)
    if m:
        end = m.group(2) or ""
        out["author_years"] = f"{m.group(1)}–{end}".rstrip("–")
    me = _EDITION_RE.search(text)   # A3：edition 进联网补抓
    if me:
        out["edition"] = me.group(1).replace(" ", "")
    for s in _SCHOOLS:
        if s in text:
            out["school"] = s
            break
    return out


def _try_wikipedia(term: str, lang: str) -> dict | None:
    """维基 REST 摘要端点；404/网络失败返 None。"""
    url = (f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/"
           f"{quote(term, safe='')}")
    r = _get(url)
    if r.status_code != 200:
        return None
    data = json.loads(r.content)  # 0.1.8 S1：bytes 直入，防 httpx 编码推断乱码
    extract = data.get("extract") or ""
    if not extract:
        return None
    fields = _extract_fields(extract)
    fields["_summary"] = extract[:300]
    return fields


def _try_baike(term: str) -> dict | None:
    """百度百科条目页（无官方接口，抓正文首屏；反爬失败即降级）。"""
    r = _get(f"https://baike.baidu.com/item/{quote(term, safe='')}")
    if r.status_code != 200 or "百度百科" not in r.text[:3000]:
        return None
    # 去标签取首段纯文本
    text = re.sub(r"<[^>]+>", "", r.text)
    m = re.search(re.escape(term) + r"[^。]{0,40}[，,是为][^。]{5,200}。", text)
    if not m:
        return None
    fields = _extract_fields(text[:5000])
    fields["_summary"] = m.group(0)[:300]
    return fields


def _try_bing(term: str) -> dict | None:
    """必应网页摘要兜底：只抽结构化线索，抽不到就算失败。"""
    r = _get(f"https://www.bing.com/search?q={quote(term, safe='')}")
    if r.status_code != 200:
        return None
    text = re.sub(r"<[^>]+>", " ", r.text)
    fields = _extract_fields(text[:20000])
    return fields or None


def enrich(author: str = "", title: str = "",
           enabled: bool = True) -> dict:
    """三级联网补充。返回 {fields, source, reports}；reports 记录每级失败
    原因（决策10：维基连不上必须显式报告，不静默）。"""
    reports: list[str] = []
    if not enabled:
        return {"fields": {}, "source": "", "reports": ["联网补充已关闭"]}
    term = (author or title or "").strip()
    if not term:
        return {"fields": {}, "source": "", "reports": ["无可查询的作者/书名"]}

    chain = [("维基百科(中文)", lambda: _try_wikipedia(term, "zh")),
             ("维基百科(英文)", lambda: _try_wikipedia(term, "en")),
             ("百度百科", lambda: _try_baike(term)),
             ("必应搜索", lambda: _try_bing(term))]
    for name, fn in chain:
        try:
            fields = fn()
        except Exception as e:  # noqa: BLE001 逐级降级，任何异常都不阻塞入库
            reports.append(f"{name}：连接失败（{type(e).__name__}）")
            continue
        if fields:
            fields.pop("_summary", None)
            return {"fields": fields, "source": name, "reports": reports}
        reports.append(f"{name}：未查到条目")
    reports.append("全部信息源均未命中，相关字段留空")
    return {"fields": {}, "source": "", "reports": reports}


def enrichment_enabled() -> bool:
    """设置开关（默认开）。"""
    s = config.load_settings()
    v = s.get("web_enrich")
    return True if v is None else bool(v)
