"""CLI 测试工具：import / rebut / search / eval / delete / serve / health。

示例：
  python cli.py import ./docs/hayek.pdf --stance liberal
  python cli.py rebut "政府管制能提高经济效率" --stance liberal --format quick
  python cli.py search "市场失灵" --stance liberal
  python cli.py eval --stance liberal --test-set ./tests/test_arguments.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config


def cmd_import(args) -> int:
    from ingestion.indexer import Indexer
    config.ensure_dirs()
    idx = Indexer()
    print(f"解析并分析中: {args.source}")
    pv = idx.preview(args.source)
    d = pv.to_dict()
    print(f"  标题: {d['title']}  章节: {d['chapters']}  "
          f"分块: {d['chunks']}  tokens≈{d['token_estimate']}")
    cls = d["classification"]
    print(f"  推断立场: {cls['stance']} (置信度 {cls['confidence']})  "
          f"理由: {cls['reason']}")
    stance = args.stance
    if not stance:
        if args.yes:
            stance = cls["stance"]
        else:
            ans = input(f"确认立场 [{cls['stance']}]（回车确认/输入其他立场）: ").strip()
            stance = ans or cls["stance"]
    result = idx.confirm(pv, stance)
    print(f"入库完成: doc_id={result['doc_id']}  stance={result['stance']}  "
          f"chunks={result['chunks']}")
    print(f"meta: {result['meta_path']}")
    return 0


def cmd_rebut(args) -> int:
    from engine.rebuttal_engine import RebuttalEngine
    config.ensure_dirs()
    t0 = time.perf_counter()
    result = RebuttalEngine().generate(args.argument, args.stance,
                                       args.format, args.style)
    dt = time.perf_counter() - t0
    print(f"\n=== 反驳（{result['provider']} · {args.format}/{args.style} · "
          f"{dt:.1f}s）===\n")
    print(result["rebuttal"])
    if result["citations"]:
        print("\n--- 引用 ---")
        for c in result["citations"]:
            print(f"  [{c['id']}] {c['author']}《{c['title']}》"
                  f"{c['year']} {c['pages']}")
    else:
        print("\n（无引用：知识库可能为空或无相关资料）")
    return 0


def cmd_search(args) -> int:
    from engine.reranker import RetrievalChain
    config.ensure_dirs()
    r = RetrievalChain().run(args.query, args.stance)
    print(f"检索 {args.query!r} · 立场 {args.stance} · "
          f"{r['retrieval_ms']}ms · 排除 {len(r['route']['excluded'])} 篇")
    if not r["chunks"]:
        print("（无结果）")
    for c in r["chunks"]:
        print(f"\n[{c['final_score']:.4f}] {c['chunk_id']} ({c['doc_id']})")
        print("  " + c["text"][:150].replace("\n", " "))
    return 0


def cmd_eval(args) -> int:
    """质量评估：test-set JSON = [{"argument": ..., "expect_doc": 可选}]"""
    from engine.rebuttal_engine import RebuttalEngine, validate_citations
    config.ensure_dirs()
    cases = json.loads(Path(args.test_set).read_text(encoding="utf-8-sig"))
    engine = RebuttalEngine()
    hit, cite_ok, total = 0, 0, len(cases)
    for i, case in enumerate(cases, 1):
        result = engine.generate(case["argument"], args.stance, "quick",
                                 "rebuttal")
        got_docs = {c["doc_id"] for c in result["citations"]}
        expected = case.get("expect_doc")
        this_hit = (not expected) or (expected in got_docs)
        hit += this_hit
        # 引用全部有效（validate 在引擎内已处理，这里核验最终输出）
        this_cite = not validate_citations(
            result["rebuttal"],
            [{"id": c["id"]} for c in result["citations"]])
        cite_ok += this_cite
        print(f"[{i}/{total}] 命中={this_hit} 引用有效={this_cite} "
              f"provider={result['provider']}")
    print(f"\n检索命中率: {hit}/{total}  引用正确率: {cite_ok}/{total}")
    return 0 if hit == total and cite_ok == total else 1


def cmd_delete(args) -> int:
    from ingestion.indexer import Indexer
    counts = Indexer().delete_document(args.doc_id)
    print(f"已删除 {args.doc_id}: {counts}")
    return 0


def cmd_health(_args) -> int:
    from api.diagnostics import health
    config.ensure_dirs()
    print(json.dumps(health(), ensure_ascii=False, indent=2))
    return 0


def cmd_migrate(_args) -> int:
    """0.1.0 旧库迁移：路径哈希 doc_id → 内容哈希 doc_id（幂等可重跑）。

    同步改写：SQLite 五表 + FTS + 向量库 + 摘要缓存（防重烧配额）+
    meta.json + 归档源文件 + INDEX.md；迁移前自动备份数据库。
    """
    import hashlib
    import shutil as _sh
    from ingestion.indexer import Indexer
    from storage.lance_store import get_vector_store
    from storage.sqlite_store import SqliteStore
    config.ensure_dirs()
    if config.SQLITE_PATH.exists():
        bak = config.SQLITE_PATH.with_suffix(".db.bak")
        _sh.copy2(config.SQLITE_PATH, bak)
        print(f"已备份数据库: {bak}")
    db, vec = SqliteStore(), get_vector_store()
    migrated = skipped = 0
    for d in db.list_documents():
        old_id = d["doc_id"]
        if d.get("content_hash"):
            skipped += 1
            continue
        # 优先用归档源文件算内容哈希；找不到用 chunks 文本兜底
        src = next(config.SOURCE_FILES_PATH.glob(f"{old_id}.*"), None)
        if src and src.is_file():
            h = hashlib.sha256(src.read_bytes()).hexdigest()
        else:
            rows = db.conn.execute(
                "SELECT text FROM chunks WHERE doc_id=? ORDER BY chunk_id",
                (old_id,)).fetchall()
            joined = "\n".join(r["text"] or "" for r in rows)
            h = hashlib.sha256(joined.encode("utf-8")).hexdigest()
        new_id = f"doc_{h[:12]}"
        if new_id == old_id:
            db.conn.execute(
                "UPDATE documents SET content_hash=? WHERE doc_id=?",
                (h, old_id))
            db.conn.commit()
            skipped += 1
            continue
        c = db.conn
        c.execute(
            "UPDATE documents SET doc_id=?, content_hash=?, source_path="
            "COALESCE(source_path, json_extract(provenance,'$.source')) "
            "WHERE doc_id=?", (new_id, h, old_id))
        for tbl, idcol in (("chapters", "chapter_id"), ("chunks", "chunk_id"),
                           ("arg_units", "arg_id")):
            c.execute(
                f"UPDATE {tbl} SET doc_id=?, {idcol}=replace({idcol},?,?) "
                f"WHERE doc_id=?", (new_id, old_id, new_id, old_id))
        c.execute(
            "UPDATE ingestion_progress SET doc_id=?, "
            "chapter_id=replace(chapter_id,?,?) WHERE doc_id=?",
            (new_id, old_id, new_id, old_id))
        c.execute(
            "UPDATE fts_index SET doc_id=?, chunk_id=replace(chunk_id,?,?) "
            "WHERE doc_id=?", (new_id, old_id, new_id, old_id))
        c.commit()
        vec.rename_doc(old_id, new_id)
        # 摘要缓存改名（内容里的 chap_id 前缀一并替换）
        cache = config.KNOWLEDGE_BASE_PATH / ".cache" / f"{old_id}.summaries.json"
        if cache.exists():
            data = cache.read_text(encoding="utf-8").replace(old_id, new_id)
            (cache.parent / f"{new_id}.summaries.json").write_text(
                data, encoding="utf-8")
            cache.unlink()
        for meta in config.STANCES_PATH.glob(f"*/{old_id}.meta.json"):
            txt = meta.read_text(encoding="utf-8").replace(old_id, new_id)
            (meta.parent / f"{new_id}.meta.json").write_text(
                txt, encoding="utf-8")
            meta.unlink()
        if src:
            src.rename(src.parent / f"{new_id}{src.suffix}")
        migrated += 1
        print(f"  {old_id} -> {new_id}")
    Indexer(db, vec)._update_index()
    print(f"迁移完成: {migrated} 篇改写, {skipped} 篇跳过")
    return 0


def cmd_serve(_args) -> int:
    import uvicorn
    from main import app
    uvicorn.run(app, host=config.API_HOST, port=config.API_PORT)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="debate-engine",
                                description=f"Debate Engine {config.VERSION} CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("import", help="导入文档/URL")
    sp.add_argument("source")
    sp.add_argument("--stance", default=None, help="指定立场（跳过确认）")
    sp.add_argument("--yes", action="store_true", help="自动采纳推断立场")
    sp.set_defaults(fn=cmd_import)

    sp = sub.add_parser("rebut", help="生成反驳")
    sp.add_argument("argument")
    sp.add_argument("--stance", required=True)
    sp.add_argument("--format", default="argument",
                    choices=["quick", "argument", "report"])
    sp.add_argument("--style", default="rebuttal")
    sp.set_defaults(fn=cmd_rebut)

    sp = sub.add_parser("search", help="搜索知识库")
    sp.add_argument("query")
    sp.add_argument("--stance", required=True)
    sp.set_defaults(fn=cmd_search)

    sp = sub.add_parser("eval", help="质量评估")
    sp.add_argument("--stance", required=True)
    sp.add_argument("--test-set", required=True)
    sp.set_defaults(fn=cmd_eval)

    sp = sub.add_parser("delete", help="删除文档（级联）")
    sp.add_argument("doc_id")
    sp.set_defaults(fn=cmd_delete)

    sp = sub.add_parser("health", help="依赖健康检查")
    sp.set_defaults(fn=cmd_health)

    sp = sub.add_parser("migrate", help="旧库迁移（路径哈希→内容哈希）")
    sp.set_defaults(fn=cmd_migrate)

    sp = sub.add_parser("serve", help="启动 FastAPI 服务")
    sp.set_defaults(fn=cmd_serve)
    return p


def _split_cmdline(line: str) -> list[str]:
    """拆分交互命令：posix=False 保护 Windows 路径反斜杠，再去掉成对引号。"""
    import shlex
    tokens = shlex.split(line, posix=False)
    return [t[1:-1] if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'" else t
            for t in tokens]


def interactive() -> int:
    """无参数启动（双击 exe）时进入交互模式，窗口不再一闪而过。"""
    parser = build_parser()
    print("=" * 50)
    print(f"  Debate Engine {config.VERSION} · 交互模式")
    print("=" * 50)
    print("输入命令后回车执行，输入 exit 退出：")
    print('  health                              健康检查')
    print('  import 文件路径 --stance liberal     导入文档')
    print('  rebut "对方论点" --stance liberal    生成反驳')
    print('  search "关键词" --stance liberal     搜索知识库')
    print('  serve                               启动 HTTP API')
    print()
    while True:
        try:
            line = input("debate> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            return 0
        try:
            args = parser.parse_args(_split_cmdline(line))
            args.fn(args)
        except SystemExit:
            pass  # argparse 报错/帮助不退出交互循环
        except Exception as exc:  # 单条命令失败不关窗口
            print(f"出错: {exc}")


def main() -> int:
    if len(sys.argv) == 1:
        return interactive()
    args = build_parser().parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
