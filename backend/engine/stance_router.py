"""StanceRouter：立场 → 检索范围与权重。

从 Skill 检索偏好读取优先/交叉/排除立场；再按坐标距离微调权重
（近 ×1.5，远 ×0.3）。输出 doc_id 白名单 + 权重表，供 retriever/reranker 使用。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from storage.skill_loader import SkillLoader, get_skill_loader
from storage.sqlite_store import SqliteStore

WEIGHT_PREFER = 1.5
WEIGHT_CROSS = 1.0
WEIGHT_NEAR = 1.5      # 坐标距离近
WEIGHT_FAR = 0.3       # 坐标距离远
COORD_NEAR_DIST = 6.0  # 9轴欧氏距离阈值


def _doc_coords(doc: dict) -> dict | None:
    try:
        prov = json.loads(doc.get("provenance") or "{}")
        coords = prov.get("coordinates") or {}
        # 只保留数值轴（过滤 low_confidence_axes 等标记键，项目10）
        coords = {k: v for k, v in coords.items()
                  if isinstance(v, (int, float))}
        return coords or None
    except json.JSONDecodeError:
        return None


def _coord_distance(a: dict, b: dict) -> float:
    keys = set(a) & set(b)
    if not keys:
        return COORD_NEAR_DIST  # 无坐标 → 中性
    return math.sqrt(sum((float(a[k]) - float(b[k])) ** 2 for k in keys))


class StanceRouter:
    def __init__(self, sqlite: SqliteStore | None = None,
                 skills: SkillLoader | None = None):
        self.db = sqlite or SqliteStore()
        self.skills = skills or get_skill_loader()

    def route(self, stance: str) -> dict:
        """返回 {doc_ids: [...], weights: {doc_id: float}, excluded: [...]}。
        doc_ids 为空列表表示知识库中没有该立场可检索的文档。"""
        skill = self.skills.get_stance(stance)
        prefs = skill.retrieval_prefs if skill else \
            {"prefer": [stance], "cross": [], "exclude": []}
        if stance not in prefs["prefer"]:
            prefs["prefer"].insert(0, stance)

        docs = self.db.list_documents()
        allowed: list[str] = []
        weights: dict[str, float] = {}
        excluded: list[str] = []

        # 以本立场文档的平均坐标为参照点（无则不启用坐标微调）
        ref = self._stance_centroid(docs, stance)

        for d in docs:
            ds = d.get("stance") or ""
            if ds in prefs["exclude"]:
                excluded.append(d["doc_id"])
                continue
            if ds in prefs["prefer"]:
                w = WEIGHT_PREFER
            elif ds in prefs["cross"]:
                w = WEIGHT_CROSS
            else:
                # 未声明的立场：坐标近 → 保留低权重；远 → 更低
                w = WEIGHT_FAR
            if ref:
                c = _doc_coords(d)
                if c:
                    dist = _coord_distance(ref, c)
                    w *= WEIGHT_NEAR if dist <= COORD_NEAR_DIST else WEIGHT_FAR
            allowed.append(d["doc_id"])
            weights[d["doc_id"]] = round(w, 3)
        return {"doc_ids": allowed, "weights": weights, "excluded": excluded,
                "prefs": prefs}

    def _stance_centroid(self, docs: list[dict], stance: str) -> dict | None:
        coords = [c for d in docs if d.get("stance") == stance
                  and (c := _doc_coords(d))]
        if not coords:
            return None
        keys = coords[0].keys()
        return {k: sum(float(c.get(k, 0)) for c in coords) / len(coords)
                for k in keys}
