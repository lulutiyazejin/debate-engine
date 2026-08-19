"""组件中心 API（0.1.4 批 5 决策 11，借鉴 ComfyUI-Manager 四态卡片）。

组件三类：
- model  ：BGE-M3 模型文件 → 数据根 models/（zip 下载，Range 断点续传 + sha256 可选校验）
- python ：OCR / Docling 解析包 → engine/_extras/{name}/（发布 zip 优先；开发态回落 pip --target）
- external：MinerU 只检测 + 官网链接，不代装

状态四态：missing / installed / disabled / (前端展示 downloading)。
下载源：GitHub Release 主源 → ModelScope 镜像备选，走代理三态。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models.embedder import embedder_status, get_embedder, reset_embedder

router = APIRouter(prefix="/api/components", tags=["components"])

_GH = "https://github.com/lulutiyazejin/debate-engine/releases/download/components-v1"
_MS = "https://modelscope.cn/api/v1/models/lulutiyazejin/debate-engine-components/repo?FilePath"

# 注册表：url 列表按序尝试（主源→镜像）；sha256 为空则只校验体积>0
_REGISTRY: dict[str, dict] = {
    "bge-m3": {
        "label": "BGE-M3 嵌入模型", "kind": "model", "size_hint": "~2.3GB",
        "desc": "生产级语义向量（装完建议全库重嵌入）；未装时用哈希降级向量",
        "urls": [f"{_GH}/bge-m3.zip", f"{_MS}=bge-m3.zip"],
        "target": lambda: config.MODELS_DIR / "bge-m3",
        "pip_dev": ["FlagEmbedding>=1.2"],
    },
    "ocr": {
        "label": "OCR 识别包（RapidOCR）", "kind": "python", "size_hint": "~60MB",
        "desc": "扫描版 PDF / 图片文字识别，装完导入自动启用",
        "urls": [f"{_GH}/ocr-win64.zip", f"{_MS}=ocr-win64.zip"],
        "target": lambda: config.EXTRAS_PATH / "ocr",
        "pip_dev": ["rapidocr-onnxruntime"],
    },
    "docling": {
        "label": "文档解析增强（Docling）", "kind": "python", "size_hint": "~500MB",
        "desc": "结构感知 PDF/DOCX 解析（表格/标题层级），未装时降级纯文本",
        "urls": [f"{_GH}/docling-win64.zip", f"{_MS}=docling-win64.zip"],
        "target": lambda: config.EXTRAS_PATH / "docling",
        "pip_dev": ["docling>=2.0"],
    },
    "mineru": {
        "label": "MinerU（外部解析引擎）", "kind": "external", "size_hint": "外装",
        "desc": "重型版面分析引擎，请按官网安装后重启软件自动检测",
        "homepage": "https://github.com/opendatalab/MinerU",
        "probe_module": "magic_pdf",
    },
}


def _state(name: str, spec: dict) -> str:
    if spec["kind"] == "external":
        try:
            __import__(spec["probe_module"])
            return "installed"
        except ImportError:
            return "missing"
    target: Path = spec["target"]()
    if not target.exists() or not any(target.iterdir()):
        return "missing"
    if (target / ".disabled").exists():
        return "disabled"
    return "installed"


@router.get("")
def list_components():
    out = []
    for name, spec in _REGISTRY.items():
        row = {"name": name, "label": spec["label"], "kind": spec["kind"],
               "size_hint": spec["size_hint"], "desc": spec["desc"],
               "state": _state(name, spec),
               "homepage": spec.get("homepage", "")}
        out.append(row)
    st = embedder_status()
    # BGE 装完引导重嵌入：统计非当前模型名的向量块数（验收红线 4）
    pending = 0
    try:
        from api.deps import get_db
        cur = get_db().conn.execute(
            "SELECT COUNT(*) FROM chunks WHERE embedding_model IS NULL "
            "OR embedding_model != ?", (get_embedder().name,))
        pending = int(cur.fetchone()[0])
    except Exception:
        pass
    return {"components": out, "embedder": st, "reembed_pending": pending}


def _download_stream(name: str, spec: dict):
    """zip 下载（Range 续传+镜像轮替）→ 解压 → 清理；开发态回落 pip --target。"""
    import urllib.error
    import urllib.request

    target: Path = spec["target"]()
    tmp = target.parent / f"{name}.zip.part"
    target.parent.mkdir(parents=True, exist_ok=True)

    def _emit(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False) + "\n"

    # 代理三态：httpx_proxy_for 决定该 URL 走不走代理
    def _opener(url: str):
        proxy = config.httpx_proxy_for(url)
        handlers = ([urllib.request.ProxyHandler({"http": proxy, "https": proxy})]
                    if proxy else [urllib.request.ProxyHandler({})])
        return urllib.request.build_opener(*handlers)

    last_err = ""
    for url in spec.get("urls", []):
        try:
            done = tmp.stat().st_size if tmp.exists() else 0
            req = urllib.request.Request(url, headers={"User-Agent": "DebateEngine"})
            if done:
                req.add_header("Range", f"bytes={done}-")
                yield _emit({"status": f"断点续传（已存 {done // 1048576}MB）"})
            with _opener(url).open(req, timeout=60) as resp:
                if done and resp.status != 206:
                    done = 0  # 服务器不支持 Range，从头下
                total = int(resp.headers.get("Content-Length", 0)) + done
                mode = "ab" if done else "wb"
                t0 = time.time()
                with open(tmp, mode) as f:
                    while True:
                        buf = resp.read(1024 * 256)
                        if not buf:
                            break
                        f.write(buf)
                        done += len(buf)
                        if done % (1024 * 1024 * 4) < 1024 * 256:
                            speed = (done / max(time.time() - t0, 0.1))
                            yield _emit({"percent": round(done * 100 / max(total, 1), 1),
                                         "done_bytes": done, "speed_bps": int(speed)})
            if tmp.stat().st_size == 0:
                raise OSError("空文件")
            yield _emit({"status": "校验并解压…", "percent": 99})
            sha = spec.get("sha256")
            if sha:
                import hashlib
                h = hashlib.sha256()
                with open(tmp, "rb") as f:
                    for blk in iter(lambda: f.read(1024 * 1024), b""):
                        h.update(blk)
                if h.hexdigest() != sha:
                    tmp.unlink(missing_ok=True)
                    raise OSError("sha256 校验失败（已删残包，请重试）")
            if target.exists():
                shutil.rmtree(target)
            with zipfile.ZipFile(tmp) as z:
                z.extractall(target)
            tmp.unlink(missing_ok=True)
            _post_install(name)
            yield _emit({"done": True, "ok": True,
                         "detail": _done_detail(name)})
            return
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            last_err = str(e)
            yield _emit({"status": f"源不可用，换镜像…（{e}）"})
            continue
    # 全部 zip 源失败：开发态（未冻结）回落 pip --target
    if not getattr(sys, "frozen", False) and spec.get("pip_dev"):
        yield _emit({"status": "发布源不可用，开发态回落 pip 安装…"})
        target.mkdir(parents=True, exist_ok=True)
        pip_target = (str(target) if spec["kind"] == "python"
                      else str(config.EXTRAS_PATH / f"{name}-runtime"))
        proc = subprocess.Popen(
            [sys.executable, "-m", "pip", "install", "--target", pip_target,
             *spec["pip_dev"]],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace")
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if line:
                yield _emit({"status": line[:120]})
        if proc.wait() == 0:
            _post_install(name)
            yield _emit({"done": True, "ok": True, "detail": _done_detail(name)})
            return
        last_err = "pip 安装失败"
    yield _emit({"done": True, "ok": False,
                 "detail": f"下载失败：{last_err}。可稍后重试（断点续传），"
                           f"或检查设置→网络与代理"})


def _post_install(name: str) -> None:
    config.mount_extras()
    if name == "bge-m3":
        reset_embedder()


def _done_detail(name: str) -> str:
    if name == "bge-m3":
        return "BGE-M3 已安装并热生效；建议到卡片上点「全库重嵌入」升级旧向量"
    return f"{_REGISTRY[name]['label']} 已安装并热生效"


@router.post("/{name}/install")
def install_component(name: str):
    spec = _REGISTRY.get(name)
    if not spec:
        raise HTTPException(404, f"未知组件 {name}")
    if spec["kind"] == "external":
        raise HTTPException(422, "外部引擎请按官网安装，本软件只做检测")
    return StreamingResponse(_download_stream(name, spec),
                             media_type="application/x-ndjson")


@router.post("/{name}/disable")
def disable_component(name: str, enable: bool = False):
    spec = _REGISTRY.get(name)
    if not spec or spec["kind"] == "external":
        raise HTTPException(404, f"组件 {name} 不支持禁用")
    target: Path = spec["target"]()
    if not target.exists():
        raise HTTPException(422, "组件未安装")
    marker = target / ".disabled"
    if enable:
        marker.unlink(missing_ok=True)
    else:
        marker.write_text("disabled", encoding="utf-8")
    _post_install(name)
    return {"name": name, "state": _state(name, spec),
            "detail": "重启软件后完全生效（已加载的模块本次会话保留）"}


@router.delete("/{name}")
def delete_component(name: str):
    spec = _REGISTRY.get(name)
    if not spec or spec["kind"] == "external":
        raise HTTPException(404, f"组件 {name} 不支持删除")
    target: Path = spec["target"]()
    if target.exists():
        shutil.rmtree(target)
    (target.parent / f"{name}.zip.part").unlink(missing_ok=True)
    _post_install(name)
    return {"name": name, "state": "missing"}


@router.post("/reembed")
def reembed_all():
    """全库重嵌入（NDJSON 进度）：只圈 embedding_model != 当前模型名的块。"""
    from api.deps import get_db, get_indexer

    def _stream():
        db = get_db()
        vec = get_indexer().vec
        emb = get_embedder()
        rows = db.conn.execute(
            "SELECT chunk_id, doc_id, text FROM chunks "
            "WHERE embedding_model IS NULL OR embedding_model != ?",
            (emb.name,)).fetchall()
        total = len(rows)
        yield json.dumps({"status": f"待重嵌入 {total} 块", "total": total},
                         ensure_ascii=False) + "\n"
        if not total:
            yield json.dumps({"done": True, "ok": True,
                              "detail": "全部向量已是当前模型，无需重嵌入"},
                             ensure_ascii=False) + "\n"
            return
        try:
            # 按文档分组：删旧向量→整篇重写，两种向量库实现接口一致
            by_doc: dict[str, list] = {}
            for r in rows:
                by_doc.setdefault(r["doc_id"], []).append(r)
            done = 0
            for doc_id, chunks in by_doc.items():
                vec.delete_doc(doc_id)
                for i in range(0, len(chunks), 16):
                    batch = chunks[i:i + 16]
                    vs = emb.embed_batch([c["text"] for c in batch])
                    for c, v in zip(batch, vs):
                        vec.add(c["chunk_id"], doc_id, v, emb.name)
                        db.conn.execute(
                            "UPDATE chunks SET embedding_model=?, embedding_dim=? "
                            "WHERE chunk_id=?", (emb.name, emb.dim, c["chunk_id"]))
                    done += len(batch)
                    yield json.dumps({"percent": round(done * 100 / total, 1),
                                      "done": False}, ensure_ascii=False) + "\n"
                db.conn.commit()
            yield json.dumps({"done": True, "ok": True,
                              "detail": f"重嵌入完成：{done} 块已升级为 {emb.name}"},
                             ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001 中断显式报告
            yield json.dumps({"done": True, "ok": False,
                              "detail": f"重嵌入中断：{e}（已完成部分保留，可重试续做）"},
                             ensure_ascii=False) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")
