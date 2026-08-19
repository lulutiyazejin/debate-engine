"""BGE-M3 嵌入模型：懒加载 / 批量嵌入 / 降级方案。

优先级：FlagEmbedding（若已安装且模型存在）→ HashEmbedder（确定性伪向量）。
HashEmbedder 用 jieba 分词 + 特征哈希实现"词袋级"语义近似——
同词汇文本向量相近，保证检索管线在无 3GB 模型的环境下可用可测。
生产环境安装 FlagEmbedding 后自动切换，无需改代码。
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config


class EmbedderBase:
    name: str = "base"
    dim: int = config.EMBEDDING_DIM

    def embed(self, text: str) -> np.ndarray:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[np.ndarray]:
        raise NotImplementedError


class BgeM3Embedder(EmbedderBase):
    """生产实现：FlagEmbedding BGE-M3（懒加载，首次调用才加载模型）。"""
    name = config.EMBEDDING_MODEL_NAME

    def __init__(self):
        self._model = None

    def _ensure(self):
        if self._model is None:
            from FlagEmbedding import BGEM3FlagModel
            model_path = (str(config.BGE_M3_PATH)
                          if config.BGE_M3_PATH.exists() else "BAAI/bge-m3")
            self._model = BGEM3FlagModel(model_path, use_fp16=True)
        return self._model

    def embed_batch(self, texts):
        m = self._ensure()
        out = m.encode(texts, batch_size=16, max_length=8192)["dense_vecs"]
        return [np.asarray(v, dtype=np.float32) for v in out]


class HashEmbedder(EmbedderBase):
    """降级实现：jieba 分词 + 特征哈希。确定性、免模型、词袋级相似度。"""
    # 注意：impl 名加后缀区分（避免与生产 BGE-M3 同名导致重嵌入范围不准）
    name = f"{config.EMBEDDING_MODEL_NAME}#hash"

    def embed_batch(self, texts):
        import jieba
        out = []
        for text in texts:
            v = np.zeros(self.dim, dtype=np.float32)
            tokens = [t for t in jieba.cut_for_search(text) if t.strip()]
            for tok in tokens:
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
                idx = h % self.dim
                sign = 1.0 if (h >> 31) & 1 == 0 else -1.0
                v[idx] += sign
            n = np.linalg.norm(v)
            out.append(v / n if n > 0 else v)
        return out


_instance: EmbedderBase | None = None


def get_embedder() -> EmbedderBase:
    """工厂：优先 BGE-M3，缺依赖时降级 HashEmbedder。单例。"""
    global _instance
    if _instance is None:
        try:
            import FlagEmbedding  # noqa: F401
            _instance = BgeM3Embedder()
        except ImportError:
            _instance = HashEmbedder()
    return _instance


def embedder_status() -> dict:
    e = get_embedder()
    return {"impl": type(e).__name__, "model": e.name, "dim": e.dim,
            "is_fallback": isinstance(e, HashEmbedder)}
