"""0.1.7 项 11:字体管理后端(PLAN-0.1.7 批 6)。

推荐字体在线下载(多源轮换 + Range 续传,借 components._download_files_stream
同款机制)/本地导入/删除;列表接口保留在 main.py(/api/fonts,theme.ts 兼容
名字数组)。字体不随安装包分发(体积红线),均 OFL 许可。
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from api.components import _opener   # 代理三态 urllib opener(0.1.6 项 1)

router = APIRouter(prefix="/api", tags=["fonts"])

_EXTS = {".ttf", ".otf", ".woff", ".woff2"}


def _fonts_dir() -> Path:
    d = config.KNOWLEDGE_BASE_PATH / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return d


# 推荐字体(11A 拍板:思源黑体 SC/IBM Plex Mono/Inter,均 OFL)。
# 主源 GitHub 走系统代理(_opener 注册表解析),备源 jsDelivr CDN 直连。
FONT_SOURCES: dict[str, dict] = {
    "noto-sans-sc": {
        "file": "NotoSansCJKsc-Regular.otf",
        "label": "思源黑体 SC", "note": "中文正文首选，全字重覆盖",
        "urls": [
            "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/"
            "SimplifiedChinese/NotoSansCJKsc-Regular.otf",
            "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/"
            "SimplifiedChinese/NotoSansCJKsc-Regular.otf",
        ],
    },
    # 0.1.8 S5：原 GitHub raw 双源 404（仓库路径调整），换 @fontsource
    # jsDelivr 主源 + unpkg 备源（实测 HTTP 200；等宽数字用途 latin 子集够用）
    "ibm-plex-mono": {
        "file": "ibm-plex-mono-latin-400-normal.woff2",
        "label": "IBM Plex Mono", "note": "等宽数字/代码用途",
        "urls": [
            "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@latest/"
            "files/ibm-plex-mono-latin-400-normal.woff2",
            "https://unpkg.com/@fontsource/ibm-plex-mono@latest/"
            "files/ibm-plex-mono-latin-400-normal.woff2",
        ],
    },
    "inter": {
        "file": "Inter-Regular.woff2",
        "label": "Inter", "note": "西文界面字体",
        "urls": [
            "https://github.com/rsms/inter/raw/master/docs/font-files/"
            "Inter-Regular.woff2",
            "https://cdn.jsdelivr.net/gh/rsms/inter@master/docs/font-files/"
            "Inter-Regular.woff2",
        ],
    },
}


@router.get("/fonts/recommended")
def fonts_recommended():
    """0.1.8 S4：推荐字体清单带 installed 状态（与已装文件比对）。"""
    d = _fonts_dir()
    return {"fonts": [
        {"key": k, "label": v.get("label", k), "note": v.get("note", ""),
         "file": v["file"],
         "installed": (d / v["file"]).exists()
                      and (d / v["file"]).stat().st_size > 0}
        for k, v in FONT_SOURCES.items()]}


class FontDownloadReq(BaseModel):
    key: str = Field(min_length=1, max_length=50)
    force: bool = False   # 0.1.8 S4：重新下载（先删旧文件，绕 exists 短路）


@router.post("/fonts/download")
def font_download(req: FontDownloadReq):
    """推荐字体下载:NDJSON 进度流,.part 断点续传,单源挂了换备源续同一文件。"""
    spec = FONT_SOURCES.get(req.key)
    if not spec:
        raise HTTPException(422, f"未知推荐字体：{req.key}")
    if req.force:   # 重新下载：删旧文件与残体，真重新拉取
        (_fonts_dir() / spec["file"]).unlink(missing_ok=True)
        Path(str(_fonts_dir() / spec["file"]) + ".part").unlink(missing_ok=True)

    def _emit(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False) + "\n"

    def gen():
        import urllib.error
        import urllib.request

        dest = _fonts_dir() / spec["file"]
        if dest.exists() and dest.stat().st_size > 0:
            yield _emit({"done": True, "ok": True,
                         "detail": f"{spec['file']} 已安装"})
            return
        tmp = Path(str(dest) + ".part")
        last_err = ""
        for url in spec["urls"]:
            try:
                done = tmp.stat().st_size if tmp.exists() else 0
                req2 = urllib.request.Request(
                    url, headers={"User-Agent": "DebateEngine"})
                if done:
                    req2.add_header("Range", f"bytes={done}-")
                    yield _emit({"status": f"续传（已存 {done // 1048576}MB）…"})
                with _opener(url).open(req2, timeout=60) as resp:
                    if done and resp.status != 206:
                        done = 0    # 源不支持 Range，从头下
                    total = int(resp.headers.get("Content-Length", 0)) + done
                    t0 = time.time()
                    with open(tmp, "ab" if done else "wb") as f:
                        while True:
                            buf = resp.read(1024 * 256)
                            if not buf:
                                break
                            f.write(buf)
                            done += len(buf)
                            if done % (1024 * 1024) < 1024 * 256:
                                speed = done / max(time.time() - t0, 0.1)
                                yield _emit({
                                    "percent": round(done * 100 / max(total, 1), 1),
                                    "status": spec["file"],
                                    "done_bytes": done, "speed_bps": int(speed)})
                if tmp.stat().st_size == 0:
                    raise OSError("空文件")
                tmp.replace(dest)   # 原子改名=完成
                yield _emit({"done": True, "ok": True,
                             "detail": f"{spec['file']} 已安装"})
                return
            except (urllib.error.URLError, urllib.error.HTTPError,
                    OSError) as e:
                last_err = f"{url} → {e}"
                yield _emit({"status": f"源不可用换备源…（{e}）"})
                continue
        yield _emit({"done": True, "ok": False,
                     "detail": f"下载失败：{last_err}。已下部分保留可续传，"
                               f"也可本地导入，或检查设置→网络与代理"})
    return StreamingResponse(gen(), media_type="application/x-ndjson")


class FontImportReq(BaseModel):
    path: str = Field(min_length=1)


@router.post("/fonts/import")
def font_import(req: FontImportReq):
    """本地字体文件导入(复制进 knowledge_base/fonts,即放即用)。"""
    p = Path(req.path)
    if not p.is_file():
        raise HTTPException(404, "文件不存在")
    if p.suffix.lower() not in _EXTS:
        raise HTTPException(
            422, f"不支持的格式：{p.suffix}（仅 ttf/otf/woff/woff2）")
    shutil.copy2(p, _fonts_dir() / p.name)
    return {"ok": True, "detail": f"{p.name} 已导入"}


@router.delete("/fonts/{name}")
def font_delete(name: str):
    """删除外挂字体(删后前端回落系统字体栈)。"""
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(422, "非法文件名")
    p = _fonts_dir() / name
    if not p.is_file():
        raise HTTPException(404, "字体不存在")
    p.unlink()
    return {"deleted": True, "name": name}
