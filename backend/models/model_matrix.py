"""模型支持矩阵（PLAN-0.1.5 G2）：单一真源。

字段：name/label/权重显存 vram_gb(Q4)/窗 window/自动档 auto_ctx/
速度档 speed/质量档 quality/prompt_tier/最低运行时 min_runtime/
KV 每 token 显存 kv_mb_per_token/8k tokens 档时 sec_per_8k/中文评级/擅长。
F1/F2/F4/F5/G1/H2/A4 全读此表；加模型=加一行，换代只改表。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

MATRIX: list[dict] = [
    {"name": "qwen3.5:35b-a3b",
     "label": "Qwen3.5 35B-A3B（首推 · 24GB 甜点）",
     "vram_gb": 21.0, "window": 65536, "auto_ctx": 32768,
     "speed": "3B 档", "quality": "32B 档", "prompt_tier": "large",
     "min_runtime": "0.12.0", "kv_mb_per_token": 0.02, "sec_per_8k": 10,
     "zh": "中文极佳", "good_at": "长文总结 / 复杂论证 / 全能"},
    {"name": "qwen2.5:14b",
     "label": "Qwen2.5 14B（余量备选）",
     "vram_gb": 10.0, "window": 32768, "auto_ctx": 32768,
     "speed": "14B 档", "quality": "14B 档", "prompt_tier": "large",
     "min_runtime": "0.1.0", "kv_mb_per_token": 0.19, "sec_per_8k": 25,
     "zh": "中文很好", "good_at": "摘要 / 反驳生成"},
    {"name": "qwen2.5:7b",
     "label": "Qwen2.5 7B（通用）",
     "vram_gb": 6.0, "window": 32768, "auto_ctx": 16384,
     "speed": "7B 档", "quality": "7B 档", "prompt_tier": "small",
     "min_runtime": "0.1.0", "kv_mb_per_token": 0.055, "sec_per_8k": 14,
     "zh": "中文良好", "good_at": "分类 / 短生成"},
    {"name": "qwen2.5:3b",
     "label": "Qwen2.5 3B（轻量）",
     "vram_gb": 3.0, "window": 32768, "auto_ctx": 8192,
     "speed": "3B 档", "quality": "3B 档", "prompt_tier": "small",
     "min_runtime": "0.1.0", "kv_mb_per_token": 0.03, "sec_per_8k": 8,
     "zh": "中文可用", "good_at": "轻量分类 / 低配机"},
    {"name": "deepseek-r1:7b",
     "label": "DeepSeek-R1 7B（推理强）",
     "vram_gb": 6.0, "window": 65536, "auto_ctx": 16384,
     "speed": "7B 档", "quality": "7B 档", "prompt_tier": "small",
     "min_runtime": "0.5.0", "kv_mb_per_token": 0.055, "sec_per_8k": 20,
     "zh": "中文良好", "good_at": "逻辑推理 / 论证解析"},
    {"name": "deepseek-r1:14b",
     "label": "DeepSeek-R1 14B（推理强·中体量）",
     "vram_gb": 10.0, "window": 65536, "auto_ctx": 32768,
     "speed": "14B 档", "quality": "14B 档", "prompt_tier": "large",
     "min_runtime": "0.5.0", "kv_mb_per_token": 0.19, "sec_per_8k": 35,
     "zh": "中文很好", "good_at": "深度推理 / 谬误检测"},
]

CTX_GEARS = [4096, 8192, 16384, 32768, 65536]

_DEFAULT_WINDOW = 4096       # Ollama 出厂默认（判墙保守值）
_DEFAULT_AUTO_CTX = 8192
_OVERHEAD_GB = 2.0           # 运行时开销固定项


def find(model: str) -> dict | None:
    """精确匹配优先；无 tag 时按主名匹配首行。"""
    for m in MATRIX:
        if m["name"] == model:
            return m
    base = model.split(":")[0]
    for m in MATRIX:
        if m["name"].split(":")[0] == base:
            return m
    return None


def window_for(model: str) -> int:
    m = find(model)
    return int(m["window"]) if m else _DEFAULT_WINDOW


def effective_ctx(model: str) -> int:
    """F2：settings ollama_ctx（auto/手动档）→ 实际 num_ctx。"""
    s = config.load_settings().get("ollama_ctx")
    if isinstance(s, dict) and s.get("mode") == "manual":
        try:
            v = int(s.get("value") or 0)
            if v in CTX_GEARS:
                return v
        except (TypeError, ValueError):
            pass
    m = find(model)
    return int(m["auto_ctx"]) if m else _DEFAULT_AUTO_CTX


def vram_estimate_gb(model: str, ctx: int) -> float:
    """F2：预估显存 = 权重(Q4) + KV×档长 + 2GB 开销；未知模型只回开销+KV。"""
    m = find(model)
    weight = float(m["vram_gb"]) if m else 0.0
    kv = float(m["kv_mb_per_token"]) if m else 0.055
    return round(weight + kv * ctx / 1024 + _OVERHEAD_GB, 1)


def sec_per_8k(model: str) -> int:
    m = find(model)
    return int(m["sec_per_8k"]) if m else 25


def _ver_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def runtime_ok(model: str, ollama_version: str | None) -> bool:
    """G2：Ollama 版本低于模型 min_runtime → 不兼容（pull 灰显）。
    探不到版本时不拦（宽松放行）。"""
    m = find(model)
    if m is None or not ollama_version:
        return True
    return _ver_tuple(ollama_version) >= _ver_tuple(m["min_runtime"])


def prompt_tier_of(model: str) -> str:
    """G1：矩阵档位；未知模型按参数量猜（≤7B 稠密=小档）。"""
    m = find(model)
    if m:
        return str(m["prompt_tier"])
    g = re.search(r"(\d+(?:\.\d+)?)b", model.lower())
    if g and float(g.group(1)) <= 7:
        return "small"
    return "large"


def recommend_for(vram_gb: float, has_gpu: bool) -> str | None:
    """H2：滤 VRAM 列——≥21→35b-a3b / ≥10→14b / ≥6→7b / ≥3→3b / 无独显→None。"""
    if not has_gpu:
        return None
    for lo, name in ((21, "qwen3.5:35b-a3b"), (10, "qwen2.5:14b"),
                     (6, "qwen2.5:7b"), (3, "qwen2.5:3b")):
        if vram_gb >= lo:
            return name
    return None
