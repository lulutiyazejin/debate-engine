"""论证对齐引擎（项目15/16/17 共用基建）：论证单元级语义配对。

消费者：
- 内部分歧地图：同立场内「论题相近、结论对立」配对
- 跨页对比：两文档（或两段粘贴文本）分歧表
- 图谱关系边：配对判定写回 arg_units.relation/target_unit_id
- 溯源追踪：全库对齐 + 文献年代排序（库内=有据，库外=模型推测）

嵌入策略：单元向量现算现用（claim+evidence 拼接嵌入，批量走 embedder）；
单元向量持久化缓存记为后续债（万级单元前无感知）。
LLM 只做轻量关系判定（无 Key 时降级规则法：只标 similar 不下结论）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from applog import new_trace_id
from models.embedder import get_embedder
from models.model_router import ModelRouter, get_router

# 六类正式关系（项目21：0.1.2 扩展 evolve/analogy/oppose；写回与图谱共用）
RELATIONS = ("support", "attack", "refine", "evolve", "analogy", "oppose")

_RELATION_PROMPT = (
    "判断两条论点的关系。只输出 JSON：\n"
    '{{"relation": "support|attack|refine|evolve|analogy|oppose|unrelated", '
    '"note": "一句话说明"}}\n'
    "support=同一结论互为支撑；attack=结论对立正面冲突；"
    "refine=同阵营内补充修正；evolve=后者对前者的思想演进/发展；"
    "analogy=不同论域的类比参照；oppose=同一论题立场相反但非直接交锋；"
    "unrelated=不在谈同一件事。\n\n"
    "论点A（{ta}）：{ca}\n论点B（{tb}）：{cb}")

_NEG_HINTS = ("不", "非", "无法", "没有", "否", "反对", "错误", "失败")


def _unit_text(u: dict) -> str:
    return f"{u.get('claim') or ''}。{u.get('evidence') or ''}"[:500]


class AlignmentEngine:
    def __init__(self, db, router: ModelRouter | None = None,
                 embedder=None):
        self.db = db
        self.router = router or get_router()
        self.embedder = embedder or get_embedder()

    # ---------- 基建：批量嵌入 + 相似度矩阵 ----------
    def _embed_units(self, units: list[dict]) -> np.ndarray:
        vecs = [np.asarray(self.embedder.embed(_unit_text(u)),
                           dtype=np.float32) for u in units]
        m = np.vstack(vecs) if vecs else np.zeros((0, config.EMBEDDING_DIM))
        norm = np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
        return m / norm

    def pair_units(self, units_a: list[dict], units_b: list[dict],
                   threshold: float = 0.55, top_pairs: int = 40,
                   skip_same_doc: bool = False) -> list[dict]:
        """相似度矩阵 → 论题相近的单元对（降序，去重每单元最多配 3 次）。"""
        if not units_a or not units_b:
            return []
        va, vb = self._embed_units(units_a), self._embed_units(units_b)
        sims = va @ vb.T
        cand = []
        for i in range(len(units_a)):
            for j in range(len(units_b)):
                ua, ub = units_a[i], units_b[j]
                if ua["arg_id"] == ub["arg_id"]:
                    continue
                if skip_same_doc and ua["doc_id"] == ub["doc_id"]:
                    continue
                s = float(sims[i, j])
                if s >= threshold:
                    cand.append((s, i, j))
        cand.sort(reverse=True)
        used: dict = {}
        pairs = []
        for s, i, j in cand:
            ka, kb = units_a[i]["arg_id"], units_b[j]["arg_id"]
            if used.get(ka, 0) >= 3 or used.get(kb, 0) >= 3:
                continue
            used[ka] = used.get(ka, 0) + 1
            used[kb] = used.get(kb, 0) + 1
            pairs.append({"a": units_a[i], "b": units_b[j],
                          "similarity": round(s, 4)})
            if len(pairs) >= top_pairs:
                break
        return pairs

    # ---------- 关系判定（LLM 轻量，离线降级规则法） ----------
    def classify_pair(self, ua: dict, ub: dict,
                      trace_id: str | None = None) -> dict:
        out, provider = self.router.run(
            "classify",
            [{"role": "user",
              "content": _RELATION_PROMPT.format(
                  ta=ua.get("thinker") or ua.get("doc_id"),
                  ca=(ua.get("claim") or "")[:300],
                  tb=ub.get("thinker") or ub.get("doc_id"),
                  cb=(ub.get("claim") or "")[:300])}],
            trace_id=trace_id or new_trace_id(),
            max_tokens=120, temperature=0.1)
        if provider != "offline":
            try:
                m = re.search(r"\{.*\}", out, re.S)
                r = json.loads(m.group()) if m else {}
                if r.get("relation") in RELATIONS + ("unrelated",):
                    return {"relation": r["relation"],
                            "note": str(r.get("note") or "")[:120],
                            "judged_by": provider}
            except (json.JSONDecodeError, AttributeError):
                pass
        # 离线/解析失败：规则法——否定词不对称可判「同题对立」，其余只标相近
        na = any(w in (ua.get("claim") or "") for w in _NEG_HINTS)
        nb = any(w in (ub.get("claim") or "") for w in _NEG_HINTS)
        if na != nb:
            return {"relation": "oppose", "note": "同题对立（否定词不对称）",
                    "judged_by": "rule"}
        return {"relation": "similar", "note": "论题相近（离线未判定）",
                "judged_by": "rule"}

    # ---------- 消费者 1：内部分歧地图 ----------
    def divergence_map(self, stance: str, max_pairs: int = 20) -> dict:
        """同立场内配对，找「论题相近、结论对立」。派别分歧是信息不是噪声。"""
        doc_ids = [d["doc_id"] for d in self.db.list_documents(stance)]
        units = [u for u in self.db.list_arg_units() if u["doc_id"] in doc_ids]
        pairs = self.pair_units(units, units, skip_same_doc=True,
                                top_pairs=max_pairs)
        out = []
        for p in pairs:
            j = self.classify_pair(p["a"], p["b"])
            if j["relation"] in ("attack", "refine", "oppose", "similar"):
                out.append({**self._pair_view(p), **j})
        return {"stance": stance, "unit_count": len(units),
                "divergences": out}

    # ---------- 消费者 2：跨页对比 ----------
    def compare_docs(self, doc_a: str, doc_b: str) -> dict:
        ua = self.db.list_arg_units(doc_a)
        ub = self.db.list_arg_units(doc_b)
        pairs = self.pair_units(ua, ub, top_pairs=20)
        rows = [{**self._pair_view(p), **self.classify_pair(p["a"], p["b"])}
                for p in pairs]
        return {"doc_a": doc_a, "doc_b": doc_b,
                "units_a": len(ua), "units_b": len(ub), "rows": rows}

    def compare_texts(self, text_a: str, text_b: str) -> dict:
        """粘贴两段文本：按句拆成临时论证单元后对齐。"""
        ua = _split_units(text_a, "text_a")
        ub = _split_units(text_b, "text_b")
        pairs = self.pair_units(ua, ub, top_pairs=20)
        rows = [{**self._pair_view(p), **self.classify_pair(p["a"], p["b"])}
                for p in pairs]
        return {"doc_a": "粘贴文本A", "doc_b": "粘贴文本B",
                "units_a": len(ua), "units_b": len(ub), "rows": rows}

    # ---------- 消费者 3：图谱关系边写回 ----------
    def build_relations(self, doc_ids: list[str] | None = None,
                        max_pairs: int = 60, mode: str | None = None) -> dict:
        """对齐配对判定并写回 relation/target_unit_id。
        0.1.9 E1: mode=None(全库)/full(全量重建)=清空后重算/incremental(新×全库交叉)。"""
        from backend.storage.sqlite_store import get_db
        db = self.db
        # 获取全库文档以便查 relations_at
        docs_map = {d["doc_id"]: d for d in db.list_documents()}
        
        if mode == "incremental":
            # 增量：找出 relations_at=NULL 的文档（未配对过或重提取后失效）
            new_docs = [doc_id for doc_id, d in docs_map.items()
                       if d.get("relations_at") is None]
            if not new_docs:
                return {"pairs_checked": 0, "relations_written": 0,
                       "hint": "无新增文档，无需增量更新"}
            # 新文档的论证单元 × 全库单元交叉配对
            units_new = [u for u in db.list_arg_units() if u["doc_id"] in new_docs]
            units_all = db.list_arg_units()
            pairs = self.pair_units(units_new, units_all, skip_same_doc=True,
                                   top_pairs=max_pairs * 3)
            written = 0
            for p in pairs:
                j = self.classify_pair(p["a"], p["b"])
                if j["relation"] in RELATIONS:
                    db.update_arg_relation(p["a"]["arg_id"], j["relation"],
                                          p["b"]["arg_id"])
                    written += 1
            # E1: 打标 relations_at（对全部新增文档打标，含无单元文档，避免 N 不归零）
            db.mark_relations_built(new_docs)
            return {"pairs_checked": len(pairs), "relations_written": written,
                   "mode": "incremental", "new_doc_count": len(new_docs)}
        elif mode == "full" or mode is None:
            # 全量：先清空全部关系边
            units = db.list_arg_units()
            for u in units:
                db.update_arg_relation(u["arg_id"], None, None)
            # 再重新判定
            doc_ids = doc_ids or None
            units = db.list_arg_units() if doc_ids is None else [u for u in db.list_arg_units()
                                                                if u["doc_id"] in doc_ids]
            pairs = self.pair_units(units, units, skip_same_doc=True,
                                   top_pairs=max_pairs)
            written = 0
            for p in pairs:
                j = self.classify_pair(p["a"], p["b"])
                if j["relation"] in RELATIONS:
                    db.update_arg_relation(p["a"]["arg_id"], j["relation"],
                                          p["b"]["arg_id"])
                    written += 1
            # E1: 全量重建完成，全库打标 relations_at
            db.mark_relations_built(None)
            return {"pairs_checked": len(pairs), "relations_written": written,
                   "mode": mode or "full"}

    # ---------- 消费者 4：溯源追踪 ----------
    def trace(self, claim: str, top_k: int = 10,
              stance: str | None = None,
              year_from: int | None = None,
              year_to: int | None = None) -> dict:
        """观点溯源：全库单元对齐 + 文献年代升序。库内=有据；
        库外补充一律标模型推测（无 Key 时省略推测段）。
        stance/year 过滤供检索区筛选栏（项目11）。"""
        docs = {d["doc_id"]: d for d in self.db.list_documents(stance)}
        units = [u for u in self.db.list_arg_units()
                 if u["doc_id"] in docs] if stance else self.db.list_arg_units()
        if not stance:
            docs = {d["doc_id"]: d for d in self.db.list_documents()}
        if year_from is not None or year_to is not None:
            def _in_range(u):
                y = docs.get(u["doc_id"], {}).get("year")
                if y is None:
                    return False
                return (year_from is None or y >= year_from) and \
                       (year_to is None or y <= year_to)
            units = [u for u in units if _in_range(u)]
        probe = [{"arg_id": "__probe__", "doc_id": "__probe__", "claim": claim}]
        pairs = self.pair_units(probe, units, threshold=0.5, top_pairs=top_k)
        rows = []
        for p in pairs:
            u = p["b"]
            d = docs.get(u["doc_id"], {})
            rows.append({"arg_id": u["arg_id"], "claim": u.get("claim"),
                         "thinker": u.get("thinker"), "school": u.get("school"),
                         "doc_id": u["doc_id"], "doc_title": d.get("title"),
                         "year": d.get("year"), "similarity": p["similarity"],
                         "evidence_level": "有据"})
        rows.sort(key=lambda r: (r["year"] is None, r["year"] or 0))
        speculation = ""
        out, provider = self.router.run(
            "classify",
            [{"role": "user",
              "content": "简述以下观点的思想史渊源（150字内，无把握就说不确定）："
                         f"{claim[:300]}"}],
            trace_id=new_trace_id(), max_tokens=300, temperature=0.3)
        if provider != "offline":
            speculation = out.strip()[:600]
        return {"claim": claim, "chain": rows,
                "speculation": speculation,
                "speculation_level": "模型推测（未经库内文献佐证）"}

    # ---------- 消费者 5：逻辑链提取（项目14：贯穿数据库的主线） ----------
    def logic_chain(self, anchor: str, stance: str | None = None,
                    max_nodes: int = 12) -> dict:
        """以锚点文本为起点，沿已写回的关系边提取连通主线，年代升序铺开。
        图谱回答「都有什么关系」，逻辑链回答「论证主线怎么一步步走过来」。"""
        units = self.db.list_arg_units()
        if stance:
            doc_ids = {d["doc_id"] for d in self.db.list_documents(stance)}
            units = [u for u in units if u["doc_id"] in doc_ids]
        by_id = {u["arg_id"]: u for u in units}
        adj: dict[str, list[tuple[str, str]]] = {}
        for u in units:
            t = u.get("target_unit_id")
            if u.get("relation") in RELATIONS and t in by_id:
                adj.setdefault(u["arg_id"], []).append((t, u["relation"]))
                adj.setdefault(t, []).append((u["arg_id"], u["relation"]))
        if not adj:
            return {"anchor": anchor, "nodes": [], "links": [],
                    "hint": "库内还没有关系边：先在图谱视图「生成/更新关系边」"
                            "（需配置模型 Key）"}
        cand = [by_id[k] for k in adj]
        probe = [{"arg_id": "__p__", "doc_id": "__p__", "claim": anchor}]
        pairs = self.pair_units(probe, cand, threshold=0.0, top_pairs=1)
        if not pairs:
            return {"anchor": anchor, "nodes": [], "links": [],
                    "hint": "没有找到与锚点相近的论点"}
        seed = pairs[0]["b"]["arg_id"]
        seen = [seed]
        queue = [seed]
        while queue and len(seen) < max_nodes:
            for nxt, _rel in adj.get(queue.pop(0), []):
                if nxt not in seen:
                    seen.append(nxt)
                    queue.append(nxt)
                    if len(seen) >= max_nodes:
                        break
        docs = {d["doc_id"]: d for d in self.db.list_documents()}
        sel = set(seen)
        nodes = [{"id": k, "claim": (by_id[k].get("claim") or "")[:120],
                  "thinker": by_id[k].get("thinker"),
                  "doc_id": by_id[k]["doc_id"],
                  "doc_title": docs.get(by_id[k]["doc_id"], {}).get("title"),
                  "stance": docs.get(by_id[k]["doc_id"], {}).get("stance"),
                  "year": docs.get(by_id[k]["doc_id"], {}).get("year")}
                 for k in seen]
        nodes.sort(key=lambda n: (n["year"] is None, n["year"] or 0))
        links = []
        dedup = set()
        for u in units:
            t = u.get("target_unit_id")
            key = (u["arg_id"], t)
            if (u.get("relation") in RELATIONS and u["arg_id"] in sel
                    and t in sel and key not in dedup):
                dedup.add(key)
                links.append({"source": u["arg_id"], "target": t,
                              "relation": u["relation"]})
        return {"anchor": anchor, "seed": seed, "nodes": nodes,
                "links": links}

    @staticmethod
    def _pair_view(p: dict) -> dict:
        return {"a_id": p["a"]["arg_id"], "a_claim": p["a"].get("claim"),
                "a_doc": p["a"]["doc_id"], "a_thinker": p["a"].get("thinker"),
                "b_id": p["b"]["arg_id"], "b_claim": p["b"].get("claim"),
                "b_doc": p["b"]["doc_id"], "b_thinker": p["b"].get("thinker"),
                "similarity": p["similarity"]}


def _split_units(text: str, prefix: str) -> list[dict]:
    """粘贴文本 → 临时论证单元：按句号/换行拆，短句并入上一句。"""
    parts = [s.strip() for s in re.split(r"[。！？\n]+", text) if s.strip()]
    units, buf = [], ""
    for s in parts:
        buf = f"{buf}{s}。"
        if len(buf) >= 12:
            units.append({"arg_id": f"{prefix}_{len(units)}",
                          "doc_id": prefix, "claim": buf})
            buf = ""
    if buf and units:
        units[-1]["claim"] += buf
    elif buf:
        units.append({"arg_id": f"{prefix}_0", "doc_id": prefix, "claim": buf})
    return units[:30]


def graph_data(db, stance: str | None = None,
               doc_id: str | None = None) -> dict:
    """图谱数据：节点=论证单元（带出处），边=六类关系。"""
    docs = {d["doc_id"]: d for d in db.list_documents(stance)}
    units = db.list_arg_units(doc_id)
    if stance:
        units = [u for u in units if u["doc_id"] in docs]
    # 0.1.8 M2：待审文档不参与图谱/脉络
    pending = db.pending_doc_ids()
    if pending:
        units = [u for u in units if u["doc_id"] not in pending]
    ids = {u["arg_id"] for u in units}
    nodes = [{"id": u["arg_id"], "claim": (u.get("claim") or "")[:80],
              "doc_id": u["doc_id"],
              "doc_title": docs.get(u["doc_id"], {}).get("title") or u["doc_id"],
              "stance": docs.get(u["doc_id"], {}).get("stance"),
              "thinker": u.get("thinker")} for u in units]
    links = [{"source": u["arg_id"], "target": u["target_unit_id"],
              "relation": u["relation"]}
             for u in units
             if u.get("relation") in RELATIONS
             and u.get("target_unit_id") in ids]
    return {"nodes": nodes, "links": links}
