"""设置端点（项目7/13）：服务商 Key 配置 + 热重载，供桌面设置页调用。

安全约定：GET 永不回传 Key 明文，只回传是否已配置。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from models.model_router import get_router, reset_router

router = APIRouter(prefix="/api", tags=["settings"])

_ENV_KEY_NAMES = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY",
                  "cerebras": "CEREBRAS_API_KEY",
                  "mistral": "MISTRAL_API_KEY",
                  "openrouter": "OPENROUTER_API_KEY"}


def _env_file_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / ".env"
    return config.BACKEND_DIR / ".env"


class KeyRequest(BaseModel):
    provider: str = Field(min_length=1)
    key: str = Field(min_length=1, max_length=500)


@router.get("/config/providers")
def list_providers():
    """各服务商配置状态（不回传明文）+ 默认模型 + 实际可用性。"""
    health = get_router().health()
    return {"default_provider": config.DEFAULT_PROVIDER,
            "providers": [
                {"name": name,
                 "configured": bool(config.PROVIDER_KEYS.get(name)),
                 "available": health.get(name, False),
                 "model": config.PROVIDER_MODELS.get(name, "")}
                for name in _ENV_KEY_NAMES] + [
                {"name": "ollama", "configured": True,
                 "available": health.get("ollama", False),
                 "model": config.PROVIDER_MODELS.get("ollama", "")}]}


@router.post("/config/key")
def set_key(req: KeyRequest):
    """写 Key 到 .env + 进程内热重载 + 重建路由器（立即生效免重启）。"""
    key_name = _ENV_KEY_NAMES.get(req.provider)
    if not key_name:
        raise HTTPException(422,
                            f"未知服务商 {req.provider}，"
                            f"可选: {list(_ENV_KEY_NAMES)}")
    env = _env_file_path()
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [ln for ln in lines if not ln.startswith(key_name + "=")]
    lines.append(f"{key_name}={req.key}")
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key_name] = req.key
    config.PROVIDER_KEYS[req.provider] = req.key
    reset_router()
    return {"provider": req.provider, "configured": True,
            "env_path": str(env)}


@router.delete("/config/key/{provider}")
def delete_key(provider: str):
    """移除 Key（.env 删行 + 进程内清空）。"""
    key_name = _ENV_KEY_NAMES.get(provider)
    if not key_name:
        raise HTTPException(422, f"未知服务商 {provider}")
    env = _env_file_path()
    if env.exists():
        lines = [ln for ln in env.read_text(encoding="utf-8").splitlines()
                 if not ln.startswith(key_name + "=")]
        env.write_text("\n".join(lines) + ("\n" if lines else ""),
                       encoding="utf-8")
    os.environ.pop(key_name, None)
    config.PROVIDER_KEYS[provider] = ""
    reset_router()
    return {"provider": provider, "configured": False}


# ---------- 0.1.2 扩展（项目23）：任务链总览 / 自定义服务商 / 参数 / 连通测试 ----------

# 任务用途说明（设置页「模型为了实现什么功能」）
_TASK_LABELS = {"summarize": "文档摘要与入库整理",
                "ideology": "22轴意识形态坐标分析",
                "rebuttal": "反驳/批判/评价生成",
                "parse": "对方论点结构解析",
                "classify": "立场分类与关系判定"}


@router.get("/config/tasks")
def task_overview():
    """任务分工总览：每任务的优先级链 + 当前实际落点（全不可用=离线兜底）。"""
    r = get_router()
    health = r.health()
    chains = config.effective_task_chains()
    out = []
    for task, chain in chains.items():
        active = next((n for n in chain
                       if n in r.providers and health.get(n)), "offline")
        out.append({"task": task, "label": _TASK_LABELS.get(task, task),
                    "chain": chain, "active": active})
    return {"tasks": out,
            "all_offline": all(t["active"] == "offline" for t in out)}


class CustomProvider(BaseModel):
    name: str = Field(min_length=1, max_length=40,
                      pattern="^[A-Za-z0-9_-]+$")
    url: str = Field(min_length=8, max_length=300)
    key: str = Field(default="", max_length=500)
    model: str = Field(min_length=1, max_length=120)
    tasks: list[str] = Field(default_factory=list)


_BUILTIN_NAMES = set(_ENV_KEY_NAMES) | {"ollama", "offline"}


@router.get("/config/custom-providers")
def list_custom_providers():
    """自定义服务商列表（Key 只回传是否已配置）。"""
    return {"providers": [{**{k: c.get(k, "") for k in
                              ("name", "url", "model")},
                           "tasks": c.get("tasks") or [],
                           "has_key": bool(c.get("key"))}
                          for c in config.effective_custom_providers()]}


@router.post("/config/custom-providers")
def add_custom_provider(req: CustomProvider):
    """新增/更新 OpenAI 兼容自定义服务商，写 settings.json + 热重建路由。
    tasks 指定要加入哪些任务链（插到链首）。"""
    if req.name in _BUILTIN_NAMES:
        raise HTTPException(422, f"{req.name} 是内置服务商名，不可占用")
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(422, "BaseURL 必须以 http(s):// 开头")
    provs = [c for c in config.effective_custom_providers()
             if c.get("name") != req.name]
    provs.append({"name": req.name, "url": req.url, "key": req.key,
                  "model": req.model, "tasks": req.tasks})
    s = config.load_settings()
    chains = s.get("task_chains") or {}
    for task in req.tasks:
        if task in config.TASK_CHAINS:
            base = chains.get(task) or list(config.TASK_CHAINS[task])
            chains[task] = [req.name] + [n for n in base if n != req.name]
    config.save_settings({"custom_providers": provs, "task_chains": chains})
    reset_router()
    return {"ok": True, "name": req.name}


@router.delete("/config/custom-providers/{name}")
def delete_custom_provider(name: str):
    provs = config.effective_custom_providers()
    kept = [c for c in provs if c.get("name") != name]
    if len(kept) == len(provs):
        raise HTTPException(404, "自定义服务商不存在")
    s = config.load_settings()
    # 0.1.5 H1：曾选它的任务摘除；槽清空时回落内置默认链（前端 toast 告知）
    affected: list[str] = []
    chains: dict[str, list[str]] = {}
    for t, chain in (s.get("task_chains") or {}).items():
        pruned = [n for n in chain if n != name]
        if len(pruned) != len(chain):
            affected.append(t)
        if not pruned and t in config.TASK_CHAINS:
            pruned = list(config.TASK_CHAINS[t])
        chains[t] = pruned
    config.save_settings({"custom_providers": kept, "task_chains": chains})
    reset_router()
    return {"ok": True, "affected_tasks": affected}


class ParamsPatch(BaseModel):
    retrieval_top_k: int | None = Field(default=None, ge=1, le=20)
    retrieval_top_k_coarse: int | None = Field(default=None, ge=5, le=100)
    full_context_token_limit: int | None = Field(default=None,
                                                 ge=1000, le=500000)


@router.get("/config/params")
def get_params():
    return {"retrieval_top_k": config.RETRIEVAL_TOP_K_FINAL,
            "retrieval_top_k_coarse": config.RETRIEVAL_TOP_K_COARSE,
            "full_context_token_limit": config.FULL_CONTEXT_TOKEN_LIMIT}


@router.patch("/config/params")
def patch_params(req: ParamsPatch):
    """生成与检索参数：写 settings.json 并热生效（项目23-B）。"""
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(422, "没有要修改的参数")
    config.save_settings(patch)
    config.apply_settings()
    return get_params()


@router.post("/config/test/{provider}")
def test_provider(provider: str):
    """连通测试：真实发一条 1-token 请求，报可用/错误原因。"""
    r = get_router()
    p = r.providers.get(provider)
    if p is None:
        raise HTTPException(404, f"服务商 {provider} 不存在")
    try:
        p.chat([{"role": "user", "content": "ping"}], task="classify",
               max_tokens=5, timeout=15.0)
        return {"provider": provider, "ok": True}
    except Exception as e:  # noqa: BLE001 测试端点要把失败原因带回给用户
        return {"provider": provider, "ok": False, "error": str(e)[:300]}


class ModelsProbe(BaseModel):
    url: str = Field(min_length=8, max_length=300)
    key: str = ""


@router.post("/config/models-probe")
def models_probe(req: ModelsProbe):
    """拉取 OpenAI 兼容服务商的可用模型清单（GET {url}/models），
    供设置页下拉选择；失败时前端回退手动输入。"""
    import httpx
    url = req.url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url   # 用户漏填协议时兜底
    headers = {"Authorization": f"Bearer {req.key}"} if req.key else {}
    try:
        try:
            r = httpx.get(f"{url}/models", headers=headers, timeout=10.0)
        except httpx.ConnectError as e:
            if "SSL" not in str(e) and "CERTIFICATE" not in str(e).upper():
                raise
            r = httpx.get(f"{url}/models", headers=headers, timeout=10.0,
                          verify=False)  # 证书审查代理环境降级
        if r.status_code != 200:
            return {"ok": False, "models": [],
                    "error": f"HTTP {r.status_code}: {r.text[:120]}"}
        data = json.loads(r.content).get("data", [])  # 0.1.8 S1：防编码推断乱码
        ids = sorted({m.get("id") for m in data if m.get("id")})
        return {"ok": True, "models": list(ids)}
    except Exception as e:  # noqa: BLE001 探测失败要带回原因
        return {"ok": False, "models": [], "error": str(e)[:200]}


class ModelOverride(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=120)


@router.patch("/config/model-override")
def model_override(req: ModelOverride):
    """内置服务商默认模型覆盖（写 settings.json + 热重建路由）。"""
    if req.provider not in config.PROVIDER_MODELS:
        raise HTTPException(422,
                            f"未知内置服务商 {req.provider}，"
                            f"可选: {list(config.PROVIDER_MODELS)}")
    overrides = config.load_settings().get("provider_models") or {}
    overrides[req.provider] = req.model
    config.save_settings({"provider_models": overrides})
    reset_router()
    return {"provider": req.provider, "model": req.model}


# ---------- 0.1.3 B6：代理三态（不开/系统/自定义，本地永远 bypass） ----------

class ProxyPatch(BaseModel):
    mode: str = Field(pattern="^(off|system|custom)$")
    url: str = Field(default="", max_length=300)


@router.get("/config/proxy")
def get_proxy():
    return config.proxy_config()


@router.patch("/config/proxy")
def patch_proxy(req: ProxyPatch):
    """写 settings.json 的 proxy 键，全部外发请求（模型/维基/百科）即时生效。"""
    if req.mode == "custom" and not req.url.startswith(("http://", "https://",
                                                        "socks5://")):
        raise HTTPException(422, "自定义代理地址须以 http(s):// 或 socks5:// 开头")
    config.save_settings({"proxy": {"mode": req.mode, "url": req.url}})
    reset_router()   # 服务商健康探测缓存基于旧网络路径，重建
    return config.proxy_config()


# ---------- 0.1.3 决策10：联网补充开关（默认开） ----------

class WebEnrichPatch(BaseModel):
    enabled: bool


@router.get("/config/web-enrich")
def get_web_enrich():
    from ingestion.web_enrich import enrichment_enabled
    return {"enabled": enrichment_enabled()}


@router.patch("/config/web-enrich")
def patch_web_enrich(req: WebEnrichPatch):
    config.save_settings({"web_enrich": req.enabled})
    return {"enabled": req.enabled}


# ---------- 0.1.3 B7：本地模型一键（Ollama） ----------

@router.get("/config/ollama/status")
def ollama_status():
    """探测 Ollama：运行状态 / 已装模型 / 矩阵候选卡（G2）/ 下载通道（F3b）/
    运行时版本比对（不兼容标升级）/ 硬件推荐徽标（H2）。
    0.1.6 hotfix：+has_binary（本机是否有二进制，区分未安装 vs 已安装未启动）。
    0.1.6 补丁项 1：cands 每项 +installed 布尔（后端统一计算，不再前端拼名）。"""
    from ingestion import ollama_adapter as oa
    from models import model_matrix as mm
    running = oa.is_installed()
    ok, hint = (True, "Ollama 正在运行") if running else oa.ensure_ollama_started()
    models = oa.models_list() if running else []
    active = config.effective_provider_models().get("ollama", "")
    version = oa.runtime_version() if running else None
    hw = config.load_settings().get("hw_profile") or {}
    rec = hw.get("recommend") or ""
    # 补丁项 1：已装模型 base 列表（大小写不敏感）
    # 0.1.7 项 12：魔搭源模型名带完整路径（modelscope.cn/unsloth/xxx），
    # 剥路径取末段与 ms_base 口径对齐，否则永不相等 → 按钮恒「下载并启用」
    installed_base = [m.split(":")[0].split("/")[-1].lower() for m in models]
    cands = []
    for m in oa.candidates():
        compat = mm.runtime_ok(m["name"], version)
        # 补丁项 1：检查 name 或 ms_name 是否在已装列表中
        name_base = m["name"].split(":")[0].lower()
        ms_name = m.get("ms_name", "") or ""
        ms_base = ms_name.split("/")[-1].split(":")[0].lower() if ms_name else ""
        installed = name_base in installed_base or ms_base in installed_base
        cands.append({
            "name": m["name"], "label": m["label"],
            "vram_gb": m["vram_gb"], "window": m["window"],
            "speed": m["speed"], "quality": m["quality"],
            "zh": m["zh"], "good_at": m["good_at"],
            "min_runtime": m["min_runtime"],
            "compat_ok": compat,
            "recommended": m["name"] == rec,
            "installed": installed,
            "ms_name": m.get("ms_name", "")})
    return {"running": running, "hint": hint,
            "installed_models": models or [],
            "active_model": active,
            "version": version,
            "channel": oa.download_channel(),
            "has_binary": oa.has_ollama_binary(),
            # 0.1.6 hotfix5：运行时安装是后台线程，刷新页面后靠它恢复进度显示
            "installing": oa.install_runtime_status()["installing"],
            "candidates": cands}


class OllamaPull(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/config/ollama/pull")
def ollama_pull(req: OllamaPull):
    """一键 pull：NDJSON 流式进度；完成即写 provider_models 热生效
    （决策 13：下载立即生效，零手工配置）。"""
    from fastapi.responses import StreamingResponse
    from ingestion import ollama_adapter as oa

    def _stream():
        import json as _json
        final = {"done": False, "ok": False, "detail": ""}
        for evt in oa.pull_stream(req.name):
            if evt.get("done"):
                final = evt
                break
            yield _json.dumps(evt, ensure_ascii=False) + "\n"
        if final.get("ok"):
            overrides = config.load_settings().get("provider_models") or {}
            overrides["ollama"] = req.name
            config.save_settings({"provider_models": overrides})
            reset_router()   # 任务落点表 10 秒内可见新模型（验收红线 6）
        yield _json.dumps(final, ensure_ascii=False) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@router.post("/config/ollama/install-runtime")
def ollama_install_runtime():
    """0.1.6 hotfix：Ollama 运行时一键装（官方安装包·代理三态·静默），
    装完由前端接一键启动。"""
    from fastapi.responses import StreamingResponse
    from ingestion import ollama_adapter as oa
    import json as _json

    def _stream():
        for evt in oa.install_runtime_stream():
            yield _json.dumps(evt, ensure_ascii=False) + "\n"
    return StreamingResponse(_stream(), media_type="application/x-ndjson")


# ---------- 0.1.4 批 5（决策 3）：任务链覆盖；0.1.5 H1：编号槽终版 ----------

class TaskChainPatch(BaseModel):
    task: str = Field(min_length=1)
    chain: list[str] = Field(min_length=1, max_length=10)


@router.patch("/config/task-chains")
def patch_task_chain(req: TaskChainPatch):
    """按任务覆盖优先级链，写 settings.json task_chains 键，热生效。
    校验：任务存在、服务商存在（内置+自定义）、offline 自动保底不许写入链。"""
    if req.task not in config.TASK_CHAINS:
        raise HTTPException(422, f"未知任务 {req.task}，可选: {list(config.TASK_CHAINS)}")
    known = set(config.PROVIDER_URLS) | {"ollama"} | {
        c.get("name") for c in config.effective_custom_providers()}
    bad = [n for n in req.chain if n not in known]
    if bad:
        raise HTTPException(422, f"未知服务商: {'、'.join(bad)}")
    if "offline" in req.chain:
        raise HTTPException(422, "offline 是自动保底，不写入链")
    s = config.load_settings()
    chains = s.get("task_chains") or {}
    chains[req.task] = req.chain
    config.save_settings({"task_chains": chains})
    reset_router()
    return {"task": req.task, "chain": req.chain}


class TaskSlotsPatch(BaseModel):
    task: str = Field(min_length=1)
    slots: list[str] = Field(min_length=1, max_length=5)


@router.patch("/config/task-slots")
def patch_task_slots(req: TaskSlotsPatch):
    """0.1.5 H1：编号槽写入——同链同源（task_chains 键，旧设置天然兼容），
    额外校验：非空 / 不重复 / 成员存在 / 上限 5 槽。"""
    if len(set(req.slots)) != len(req.slots):
        raise HTTPException(422, "槽成员不可重复")
    return patch_task_chain(TaskChainPatch(task=req.task, chain=req.slots))


# ---------- 0.1.4 批 5（决策 2）：数据目录迁移 ----------

class MigratePost(BaseModel):
    target: str = Field(min_length=3)


@router.get("/config/data-root")
def get_data_root():
    """0.1.5 D5：追加旧（默认）目录路径与体积，供回滚引导。"""
    import os
    default = Path(os.getenv("KB_PATH",
                             str(config.PROJECT_ROOT / "knowledge_base")))
    overridden = config.DATA_ROOT_MARKER.exists()
    old_size = 0
    old_ok = False
    if overridden and default.exists():
        old_ok = (default / "knowledge.db").exists()
        try:
            old_size = sum(p.stat().st_size
                           for p in default.rglob("*") if p.is_file())
        except OSError:
            old_size = 0
    return {"path": str(config.KNOWLEDGE_BASE_PATH),
            "marker": str(config.DATA_ROOT_MARKER),
            "overridden": overridden,
            "old_path": str(default) if overridden else "",
            "old_size_bytes": old_size,
            "old_rollback_ok": old_ok}


@router.post("/config/data-root/rollback")
def rollback_data_root():
    """0.1.5 D5：回滚到旧目录——删 data-root.txt 标记回默认路径；
    需旧路径 knowledge.db 在；重启生效；迁移后目录保留不删。"""
    import os
    if not config.DATA_ROOT_MARKER.exists():
        raise HTTPException(422, "当前未迁移，无需回滚")
    default = Path(os.getenv("KB_PATH",
                             str(config.PROJECT_ROOT / "knowledge_base")))
    if not (default / "knowledge.db").exists():
        raise HTTPException(422, f"旧目录无 knowledge.db（{default}），不能回滚")
    try:
        config.DATA_ROOT_MARKER.unlink()
    except OSError as e:
        raise HTTPException(500, f"回滚失败：{e}")
    return {"ok": True, "detail": f"已回滚到 {default}，重启软件生效；"
                                  "迁移后的目录保留未动"}


@router.post("/config/data-root/migrate")
def migrate_data(req: MigratePost):
    """整目录复制迁移（NDJSON 进度：体积/速度）→ 写 data-root.txt → 提示重启。
    旧目录保留（决策 2）；目标须为空目录或不存在。"""
    import json as _json
    import shutil
    import time as _time
    from fastapi.responses import StreamingResponse

    src = config.KNOWLEDGE_BASE_PATH
    dst = Path(req.target)
    if dst.exists() and any(dst.iterdir()):
        raise HTTPException(422, "目标目录非空，请选择空目录或新目录")
    try:
        dst.mkdir(parents=True, exist_ok=True)
        probe = dst / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        raise HTTPException(422, f"目标目录不可写: {e}")

    def _stream():
        from api.deps import get_engine
        # 1) SQLite 落盘冻结（WAL 并入主库，副本自洽）
        try:
            get_engine().db.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception as e:  # noqa: BLE001 诊断信息带回
            yield _json.dumps({"status": f"checkpoint 跳过（{e}）"},
                              ensure_ascii=False) + "\n"
        files = [p for p in src.rglob("*") if p.is_file()]
        total = sum(p.stat().st_size for p in files)
        done = 0
        t0 = _time.time()
        yield _json.dumps({"status": "开始复制", "total_bytes": total,
                           "files": len(files)}, ensure_ascii=False) + "\n"
        try:
            for i, p in enumerate(files):
                rel = p.relative_to(src)
                tp = dst / rel
                tp.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, tp)
                done += p.stat().st_size
                if i % 20 == 0 or done == total:
                    speed = done / max(_time.time() - t0, 0.1)
                    yield _json.dumps({
                        "percent": round(done * 100 / max(total, 1), 1),
                        "done_bytes": done, "speed_bps": int(speed),
                    }, ensure_ascii=False) + "\n"
            # 2) 写数据根标记（放数据目录之外，%APPDATA%）
            config.DATA_ROOT_MARKER.parent.mkdir(parents=True, exist_ok=True)
            config.DATA_ROOT_MARKER.write_text(str(dst), encoding="utf-8")
            yield _json.dumps({"done": True, "ok": True,
                               "detail": f"已迁移到 {dst}，重启软件生效；"
                                         f"旧目录保留于 {src}"},
                              ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001 复制中断显式报告
            yield _json.dumps({"done": True, "ok": False,
                               "detail": f"迁移失败：{e}（旧目录未动，可重试）"},
                              ensure_ascii=False) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


# ---------- 0.1.6 项 7：UI 偏好迁 settings.json（升级不丢） ----------
@router.get("/config/ui-prefs")
def get_ui_prefs():
    """UI 偏好全量（主题/手势/快捷键/立方控件等，前端 localStorage 镜像）。"""
    up = config.load_settings().get("ui_prefs")
    return up if isinstance(up, dict) else {}


@router.patch("/config/ui-prefs")
def patch_ui_prefs(payload: dict):
    """浅合并写回 ui_prefs 键（值为前端 localStorage 原串，无损往返）。"""
    cur = config.load_settings().get("ui_prefs")
    cur = dict(cur) if isinstance(cur, dict) else {}
    cur.update({str(k): v for k, v in payload.items()})
    config.save_settings({"ui_prefs": cur})
    return cur


@router.get("/config/paths")
def get_paths():
    """0.1.6 项 7/11：软件信息页显示设置文件/数据根/组件/模型目录（可定位可备份）。"""
    return {"settings_path": str(config.SETTINGS_PATH),
            "data_root": str(config.KNOWLEDGE_BASE_PATH),
            "components_dir": str(config.EXTRAS_PATH),
            "models_dir": str(config.MODELS_DIR)}
