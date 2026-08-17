"""配置管理：路径 / API Key / 模型选择 / 日志级别。

所有配置集中此处，环境变量优先（.env 自动加载）。
"""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------- 路径 ----------
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
KNOWLEDGE_BASE_PATH = Path(os.getenv("KB_PATH", PROJECT_ROOT / "knowledge_base"))
SQLITE_PATH = Path(os.getenv("SQLITE_PATH", KNOWLEDGE_BASE_PATH / "knowledge.db"))
LANCE_PATH = Path(os.getenv("LANCE_PATH", KNOWLEDGE_BASE_PATH / "vector_store"))
SKILLS_PATH = KNOWLEDGE_BASE_PATH / "skills"
STANCES_PATH = KNOWLEDGE_BASE_PATH / "stances"
INBOX_PATH = KNOWLEDGE_BASE_PATH / "inbox"
LOGS_PATH = KNOWLEDGE_BASE_PATH / "logs"
SOURCE_FILES_PATH = KNOWLEDGE_BASE_PATH / "source_files"
INDEX_MD_PATH = KNOWLEDGE_BASE_PATH / "INDEX.md"

# ---------- 嵌入模型 ----------
BGE_M3_PATH = Path(os.getenv("BGE_M3_PATH", PROJECT_ROOT / "models" / "bge-m3"))
EMBEDDING_MODEL_NAME = "bge-m3-v1.5"
EMBEDDING_DIM = 1024

# ---------- 日志 ----------
# minimal / standard / debug（debug 关闭软件后复位，由前端负责）
LOG_PRIVACY_LEVEL = os.getenv("LOG_PRIVACY_LEVEL", "minimal")

# ---------- LLM 服务商 ----------
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "groq")

# API Key 环境变量映射（不存在 = 该服务商不可用）
PROVIDER_KEYS = {
    "groq": os.getenv("GROQ_API_KEY", ""),
    "gemini": os.getenv("GEMINI_API_KEY", ""),
    "cerebras": os.getenv("CEREBRAS_API_KEY", ""),
    "mistral": os.getenv("MISTRAL_API_KEY", ""),
    "openrouter": os.getenv("OPENROUTER_API_KEY", ""),
}

PROVIDER_URLS = {
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "cerebras": "https://api.cerebras.ai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "ollama": os.getenv("OLLAMA_URL", "http://localhost:11434/v1"),
}

PROVIDER_MODELS = {
    "groq": os.getenv("GROQ_MODEL", "qwen/qwen3-32b"),
    "gemini": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
    "cerebras": os.getenv("CEREBRAS_MODEL", "qwen-3-32b"),
    "mistral": os.getenv("MISTRAL_MODEL", "mistral-large-latest"),
    "openrouter": os.getenv("OPENROUTER_MODEL", "z-ai/glm-4.5-air:free"),
    "ollama": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
}

# 自定义服务商：JSON 格式 [{"name":..,"url":..,"key":..,"model":..}]
CUSTOM_PROVIDERS_JSON = os.getenv("CUSTOM_PROVIDERS", "[]")

# ---------- 任务 → 服务商优先级链 ----------
TASK_CHAINS: dict[str, list[str]] = {
    "summarize": ["gemini", "cerebras", "groq", "ollama"],
    "ideology": ["ollama", "groq", "mistral"],
    "rebuttal": ["groq", "gemini", "cerebras", "ollama"],
    "parse": ["groq", "cerebras", "ollama"],
    "classify": ["ollama", "groq", "cerebras"],
}

# ---------- 检索参数 ----------
RETRIEVAL_TOP_K_COARSE = 20   # 粗检索每路 Top-K
RETRIEVAL_TOP_K_FINAL = 5     # 精排后最终数
RRF_K = 60                    # RRF 融合常数
CHUNK_MAX_TOKENS = 8000       # 单块上限
SHORT_DOC_TOKENS = 2000       # 短文章阈值（不切割）

# ---------- 服务 ----------
API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "7700"))


def ensure_dirs() -> None:
    """启动时确保所有运行时目录存在。"""
    for p in (KNOWLEDGE_BASE_PATH, LANCE_PATH, SKILLS_PATH / "stances",
              SKILLS_PATH / "ingestion", STANCES_PATH, INBOX_PATH,
              LOGS_PATH, SOURCE_FILES_PATH):
        p.mkdir(parents=True, exist_ok=True)
