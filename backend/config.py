"""配置管理：路径 / API Key / 模型选择 / 日志级别。

所有配置集中此处，环境变量优先（.env 自动加载）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------- 版本（全局唯一来源，main/diagnostics/cli 均引用此处） ----------
VERSION = "0.1.6"

# ---------- 存储后端（服务器级抽象层：当前仅 sqlite，未来可插 postgres） ----------
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "sqlite")

# ---------- 路径 ----------
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent


def _data_root_override() -> Path | None:
    """0.1.4 批 5（决策 2）：%APPDATA%\\DebateEngine\\data-root.txt 记迁移后数据根。
    文件放数据目录之外，迁移不会把自己带走；无效路径忽略回默认。"""
    try:
        appdata = os.getenv("APPDATA")
        if not appdata:
            return None
        marker = Path(appdata) / "DebateEngine" / "data-root.txt"
        if not marker.exists():
            return None
        target = Path(marker.read_text(encoding="utf-8").strip())
        if target.exists() and (target / "knowledge.db").exists():
            return target
    except Exception:
        pass
    return None


DATA_ROOT_MARKER = (Path(os.getenv("APPDATA", str(PROJECT_ROOT)))
                    / "DebateEngine" / "data-root.txt")
KNOWLEDGE_BASE_PATH = (_data_root_override()
                       or Path(os.getenv("KB_PATH",
                                         PROJECT_ROOT / "knowledge_base")))
SQLITE_PATH = Path(os.getenv("SQLITE_PATH", KNOWLEDGE_BASE_PATH / "knowledge.db"))
LANCE_PATH = Path(os.getenv("LANCE_PATH", KNOWLEDGE_BASE_PATH / "vector_store"))
SKILLS_PATH = KNOWLEDGE_BASE_PATH / "skills"
STANCES_PATH = KNOWLEDGE_BASE_PATH / "stances"
INBOX_PATH = KNOWLEDGE_BASE_PATH / "inbox"
LOGS_PATH = KNOWLEDGE_BASE_PATH / "logs"
SOURCE_FILES_PATH = KNOWLEDGE_BASE_PATH / "source_files"
INDEX_MD_PATH = KNOWLEDGE_BASE_PATH / "INDEX.md"

# ---------- 嵌入模型与组件中心（0.1.4 批 5 决策 11） ----------
# 0.1.6 项 11：模型/组件独立文件夹落安装目录（frozen=exe 上上级=安装根，dev=项目根）。
# 旧 EXTRAS=engine/_extras 升级安装覆盖 engine 目录会冲掉已装组件（真 bug）；
# 新目录 installer 不打包不覆盖，升级保留。
INSTALL_DIR = (Path(sys.executable).resolve().parent.parent
               if getattr(sys, "frozen", False) else PROJECT_ROOT)
MODELS_DIR = INSTALL_DIR / "models"                  # 组件中心下载的模型
EXTRAS_PATH = INSTALL_DIR / "components"             # python 组件包落盘目录
_BGE_DL = MODELS_DIR / "bge-m3"
BGE_M3_PATH = Path(os.getenv("BGE_M3_PATH", str(_BGE_DL)))


def migrate_component_dirs() -> None:
    """0.1.6 项 11 首启一次性搬移（幂等）：旧 engine/_extras 组件包、
    旧数据根 models/bge-m3 → 安装目录独立文件夹；新位置已存在则跳过。"""
    import shutil
    old_extras = BACKEND_DIR / "engine" / "_extras"
    try:
        if old_extras.exists():
            EXTRAS_PATH.mkdir(parents=True, exist_ok=True)
            for d in old_extras.iterdir():
                if d.is_dir() and not (EXTRAS_PATH / d.name).exists():
                    shutil.move(str(d), str(EXTRAS_PATH / d.name))
    except OSError:
        pass
    old_model = KNOWLEDGE_BASE_PATH / "models" / "bge-m3"
    try:
        if old_model.exists() and not _BGE_DL.exists():
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_model), str(_BGE_DL))
    except OSError:
        pass


def mount_extras() -> list[str]:
    """启动时把已安装且未禁用的组件包目录挂 sys.path（禁用= .disabled 标记）。"""
    import sys as _sys
    migrate_component_dirs()   # 项 11：挂载前先完成旧目录搬移
    mounted: list[str] = []
    try:
        if EXTRAS_PATH.exists():
            for d in EXTRAS_PATH.iterdir():
                if d.is_dir() and not (d / ".disabled").exists():
                    _sys.path.insert(0, str(d))
                    mounted.append(d.name)
    except OSError:
        pass
    return mounted


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

# ---------- 摘要策略（项目5） ----------
# auto 策略下：文档总 token 低于此阈值整书投喂（大窗口模型如 Gemini），
# 超限自动回落 Map-Reduce
FULL_CONTEXT_TOKEN_LIMIT = int(os.getenv("FULL_CONTEXT_TOKEN_LIMIT", "80000"))

# ---------- 服务 ----------
API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "7700"))

# ---------- settings.json 覆盖层（项目23：设置页可写配置，跟知识库走） ----------
SETTINGS_PATH = KNOWLEDGE_BASE_PATH / "settings.json"

# 设置页可调且热生效的参数白名单（键 → 本模块属性名）
_TUNABLE = {"retrieval_top_k": "RETRIEVAL_TOP_K_FINAL",
            "retrieval_top_k_coarse": "RETRIEVAL_TOP_K_COARSE",
            "full_context_token_limit": "FULL_CONTEXT_TOKEN_LIMIT"}


def load_settings() -> dict:
    """读 settings.json（缺失/损坏回空 dict，不阻断启动）。"""
    try:
        import json
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(patch: dict) -> dict:
    """浅合并写回 settings.json，返回合并后全量。"""
    import json
    data = load_settings()
    data.update(patch)
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                             encoding="utf-8")
    return data


def apply_settings() -> None:
    """启动时/写入后调用：把 settings.json 的可调参数落到本模块属性。"""
    s = load_settings()
    for key, attr in _TUNABLE.items():
        if isinstance(s.get(key), int) and s[key] > 0:
            globals()[attr] = s[key]


def effective_custom_providers() -> list[dict]:
    """自定义服务商：settings.json 优先，其次环境变量 CUSTOM_PROVIDERS。"""
    import json
    s = load_settings()
    if isinstance(s.get("custom_providers"), list):
        return s["custom_providers"]
    try:
        return json.loads(CUSTOM_PROVIDERS_JSON)
    except json.JSONDecodeError:
        return []


def effective_task_chains() -> dict[str, list[str]]:
    """任务链：settings.json 的 task_chains 按任务覆盖默认表。"""
    s = load_settings()
    chains = dict(TASK_CHAINS)
    if isinstance(s.get("task_chains"), dict):
        for task, chain in s["task_chains"].items():
            if task in chains and isinstance(chain, list) and chain:
                chains[task] = [str(x) for x in chain]
    return chains


def effective_provider_models() -> dict[str, str]:
    """模型覆盖：settings.json 的 provider_models 按服务商覆盖默认模型，
    实现「想调哪个模型就调哪个」（内置与自定义均适用）。"""
    s = load_settings()
    models = dict(PROVIDER_MODELS)
    if isinstance(s.get("provider_models"), dict):
        for name, model in s["provider_models"].items():
            if name in models and isinstance(model, str) and model.strip():
                models[name] = model.strip()
    return models


# ---------- 代理三态（0.1.3 B6：不开/系统/自定义，本地地址永远直连） ----------
_LOCAL_HOSTS = ("127.0.0.1", "localhost", "0.0.0.0")

# 0.1.6 补丁项 2/7：域名直连白名单（不挂代理）
DIRECT_HOSTS = {"modelscope.cn", "download.pytorch.org"}


def proxy_config() -> dict:
    """settings.json 的 proxy 键：{"mode": "off|system|custom", "url": "..."}。"""
    s = load_settings()
    p = s.get("proxy") if isinstance(s.get("proxy"), dict) else {}
    mode = p.get("mode") if p.get("mode") in ("off", "system", "custom") else "off"
    return {"mode": mode, "url": str(p.get("url") or "")}


def system_proxy_url() -> str | None:
    """0.1.6 项 1：解析系统代理真实地址。
    Windows 读注册表 Internet Settings（ProxyEnable+ProxyServer）；
    PAC 脚本模式（ProxyServer 空）无法解析返回 None；
    非 Windows 回落环境变量 HTTPS_PROXY。安装版引擎由 Tauri 干净环境
    拉起不带 env，故 system 模式必须主动解析而非信任环境。"""
    if sys.platform == "win32":
        try:
            import winreg
            k = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
            enable, _ = winreg.QueryValueEx(k, "ProxyEnable")
            server, _ = winreg.QueryValueEx(k, "ProxyServer")
            winreg.CloseKey(k)
            if not enable or not str(server).strip():
                return None
            server = str(server).strip()
            # 多协议形式 "http=127.0.0.1:7890;https=..." 取 https/http 段
            if "=" in server:
                parts = dict(p.split("=", 1) for p in server.split(";") if "=" in p)
                server = parts.get("https") or parts.get("http") or ""
            if not server:
                return None
            return server if "://" in server else f"http://{server}"
        except OSError:
            return None
    return os.getenv("HTTPS_PROXY") or os.getenv("https_proxy") or None


def httpx_proxy_for(url: str) -> str | None:
    """按代理三态给 httpx 的 proxy 参数；127.0.0.1/localhost 一律 bypass
    （否则代理会切断本地 ollama）。system 模式解析注册表真实地址
    （0.1.6 项 1：不再依赖环境变量，安装版干净环境也能走代理）。
    0.1.6 补丁项 2：DIRECT_HOSTS 白名单（魔搭/pytorch 国内直连快过代理）。"""
    try:
        host = url.split("://", 1)[-1].split("/", 1)[0].split(":")[0]
    except Exception:
        host = ""
    if host in _LOCAL_HOSTS:
        return None
    # 补丁项 2：白名单域名（含子域名）直连
    for direct in DIRECT_HOSTS:
        if host == direct or host.endswith("." + direct):
            return None
    cfg = proxy_config()
    if cfg["mode"] == "custom" and cfg["url"]:
        return cfg["url"]
    if cfg["mode"] == "system":
        return system_proxy_url()
    return None


def httpx_trust_env_for(url: str) -> bool:
    """0.1.6 项 1：统一 False——代理一律由 httpx_proxy_for 显式传参，
    不再信环境变量（语义简化，避免 shell 残留 env 干扰）。"""
    return False


apply_settings()


def reload_provider_keys() -> None:
    """config 命令/设置页写入 .env 后热重载 Key，无需重启。"""
    try:
        from dotenv import load_dotenv as _ld
        _ld(override=True)
    except ImportError:
        pass
    for name, env in (("groq", "GROQ_API_KEY"), ("gemini", "GEMINI_API_KEY"),
                      ("cerebras", "CEREBRAS_API_KEY"),
                      ("mistral", "MISTRAL_API_KEY"),
                      ("openrouter", "OPENROUTER_API_KEY")):
        PROVIDER_KEYS[name] = os.getenv(env, "")


def ensure_dirs() -> None:
    """启动时确保所有运行时目录存在。"""
    for p in (KNOWLEDGE_BASE_PATH, LANCE_PATH, SKILLS_PATH / "stances",
              SKILLS_PATH / "ingestion", STANCES_PATH, INBOX_PATH,
              LOGS_PATH, SOURCE_FILES_PATH):
        p.mkdir(parents=True, exist_ok=True)
