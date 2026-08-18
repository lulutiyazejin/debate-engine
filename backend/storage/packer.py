"""知识库打包器（项目14）：本地导出/分享包 + 备份，一套格式两处复用。

包格式 debkb/1（zip）：
- manifest.json：格式版本/应用版本/嵌入模型版本/统计
- data.json：documents/chapters/chunks（含全文，必含）/arg_units
- vectors.npz：可选，chunk_id → float32 向量
- skills/：立场与入库 Skill、styles/fallacies/centers 知识文件

隐私红线：白名单打包——只收上述四类内容，logs/ 与 .env 从结构上进不来；
verify() 再做一次解压零隐私文件断言。
导入合并：查重走项目2 内容哈希逻辑；嵌入模型不匹配时用包内文本重嵌入。
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

FORMAT = "debkb/1"
# 隐私红线黑名单：verify 断言包内不得出现的路径片段
_PRIVACY_BANNED = ("logs/", ".env", "logs\\")


class KnowledgePacker:
    def __init__(self, db, vec):
        self.db = db
        self.vec = vec

    # ---------- 打包 ----------
    def pack(self, out_path: str | Path, doc_ids: list[str] | None = None,
             include_vectors: bool = True) -> dict:
        """导出指定文档（None=全库）为 .debkb 包。返回统计。"""
        docs = [d for d in self.db.list_documents()
                if doc_ids is None or d["doc_id"] in doc_ids]
        if not docs:
            raise ValueError("没有可导出的文档")
        data: dict = {"documents": docs, "chapters": [], "chunks": [],
                      "arg_units": []}
        vectors: dict[str, np.ndarray] = {}
        for d in docs:
            did = d["doc_id"]
            data["chapters"] += [dict(r) for r in self.db.conn.execute(
                "SELECT * FROM chapters WHERE doc_id=?", (did,))]
            data["chunks"] += [dict(r) for r in self.db.conn.execute(
                "SELECT * FROM chunks WHERE doc_id=?", (did,))]
            data["arg_units"] += self.db.list_arg_units(did)
            if include_vectors:
                for row in self.vec.export_doc(did):
                    if row["embedding_model"] == config.EMBEDDING_MODEL_NAME:
                        vectors[row["chunk_id"]] = np.asarray(
                            row["vector"], dtype=np.float32)
        manifest = {
            "format": FORMAT,
            "app_version": config.VERSION,
            "embedding_model": config.EMBEDDING_MODEL_NAME,
            "embedding_dim": config.EMBEDDING_DIM,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "documents": len(docs),
            "chunks": len(data["chunks"]),
            "vectors": len(vectors),
        }
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json",
                       json.dumps(manifest, ensure_ascii=False, indent=2))
            z.writestr("data.json", json.dumps(data, ensure_ascii=False))
            if vectors:
                buf = io.BytesIO()
                np.savez_compressed(buf, **vectors)
                z.writestr("vectors.npz", buf.getvalue())
            # skills：白名单收录 md（永不触碰 logs/.env）
            for p in sorted(config.SKILLS_PATH.rglob("*.md")):
                z.writestr(f"skills/{p.relative_to(config.SKILLS_PATH).as_posix()}",
                           p.read_text(encoding="utf-8"))
        manifest["path"] = str(out_path)
        manifest["size_bytes"] = out_path.stat().st_size
        return manifest

    # ---------- 校验 ----------
    @staticmethod
    def verify(path: str | Path) -> dict:
        """校验包格式 + 隐私红线（零 logs/.env 文件）。返回 manifest。"""
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            for n in names:
                low = n.lower()
                if any(b in low for b in _PRIVACY_BANNED):
                    raise ValueError(f"包内含隐私文件，拒绝处理: {n}")
            if "manifest.json" not in names or "data.json" not in names:
                raise ValueError("不是有效的知识库包（缺 manifest/data）")
            manifest = json.loads(z.read("manifest.json"))
        if manifest.get("format") != FORMAT:
            raise ValueError(f"包格式不支持: {manifest.get('format')}")
        return manifest

    # ---------- 导入合并 ----------
    def import_package(self, path: str | Path,
                       on_duplicate: str = "skip") -> dict:
        """合并分享包入库：查重（内容哈希）→ 五表写入 + FTS →
        向量直入（模型匹配）或包内文本重嵌入（模型漂移）。"""
        manifest = self.verify(path)
        with zipfile.ZipFile(path) as z:
            data = json.loads(z.read("data.json"))
            vec_npz = {}
            if "vectors.npz" in z.namelist():
                vec_npz = dict(np.load(io.BytesIO(z.read("vectors.npz"))))
        same_model = manifest.get("embedding_model") == config.EMBEDDING_MODEL_NAME
        embedder = None

        def _embed(text: str):
            nonlocal embedder
            if embedder is None:
                from models.embedder import get_embedder
                embedder = get_embedder()
            return embedder.embed(text)

        chapters = {}
        chunks_by_doc: dict[str, list[dict]] = {}
        args_by_doc: dict[str, list[dict]] = {}
        for c in data["chapters"]:
            chapters.setdefault(c["doc_id"], []).append(c)
        for c in data["chunks"]:
            chunks_by_doc.setdefault(c["doc_id"], []).append(c)
        for a in data["arg_units"]:
            args_by_doc.setdefault(a["doc_id"], []).append(a)

        report = {"imported": 0, "skipped": 0, "replaced": 0, "reembedded": 0}
        for doc in data["documents"]:
            did = doc["doc_id"]
            dup = (self.db.find_by_hash(doc.get("content_hash"))
                   if doc.get("content_hash") else self.db.get_document(did))
            if dup:
                if on_duplicate == "skip":
                    report["skipped"] += 1
                    continue
                self.db.delete_document(dup["doc_id"], hard=True)
                self.vec.delete_doc(dup["doc_id"])
                report["replaced"] += 1
            # JSON 字段还原（list_documents 返回的是序列化行）
            doc = dict(doc)
            for k in ("secondary_stances", "provenance"):
                if isinstance(doc.get(k), str):
                    try:
                        doc[k] = json.loads(doc[k] or "null") or (
                            [] if k == "secondary_stances" else {})
                    except json.JSONDecodeError:
                        doc[k] = [] if k == "secondary_stances" else {}
            self.db.upsert_document(doc)
            for ch in chapters.get(did, []):
                self.db.upsert_chapter(dict(ch))
            for ck in chunks_by_doc.get(did, []):
                self.db.insert_chunk(dict(ck))
                cid = ck["chunk_id"]
                if same_model and cid in vec_npz:
                    self.vec.add(cid, did, vec_npz[cid],
                                 config.EMBEDDING_MODEL_NAME)
                else:
                    # 嵌入漂移或包内缺向量：用包内必含文本重嵌入
                    self.vec.add(cid, did, _embed(ck["text"]),
                                 config.EMBEDDING_MODEL_NAME)
                    report["reembedded"] += 1
            for a in args_by_doc.get(did, []):
                a = dict(a)
                for k in ("counter_targets", "coordinates"):
                    if isinstance(a.get(k), str):
                        try:
                            a[k] = json.loads(a[k] or "null") or (
                                [] if k == "counter_targets" else {})
                        except json.JSONDecodeError:
                            a[k] = [] if k == "counter_targets" else {}
                self.db.insert_arg_unit(a)
            report["imported"] += 1
        return {"manifest": manifest, **report}
