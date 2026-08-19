# -*- coding: utf-8 -*-
"""组件 zip 资产打包脚本（PLAN-0.1.5 A4/C3）。

用法（在仓库根目录、联网环境下）：
    backend\\.venv\\Scripts\\python.exe scripts\\build_component_zips.py [名称...]

对 components.py 注册表中的 python 类组件执行：
    pip install --target <临时目录> <依赖> → 整目录打成 <名称>-win64.zip
bge-m3 模型包需先用 FlagEmbedding 拉取模型目录后打包（体积 ~2.3GB）。
产物落 dist_components/，随 GitHub Release（tag=components-v1）上传后，
components.py 中的 _GH 真实 URL 即可走通断点续传。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist_components"

SPECS = {
    "ocr-win64": ["rapidocr-onnxruntime", "pypdfium2"],
    "docling-win64": ["docling>=2.0"],
}


def build_pip_zip(name: str, pkgs: list[str]) -> Path:
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / name
        print(f"[{name}] pip install --target {target} {' '.join(pkgs)}")
        subprocess.run([sys.executable, "-m", "pip", "install",
                        "--target", str(target), *pkgs], check=True)
        zp = OUT / f"{name}.zip"
        print(f"[{name}] 打包 → {zp}")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(target.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(target))
        return zp


def build_bge_zip() -> Path | None:
    """bge-m3.zip：需本机已有模型目录（FlagEmbedding 首跑自动下载）。"""
    cand = ROOT / "backend" / "knowledge_base" / "models" / "bge-m3"
    if not cand.exists():
        print("[bge-m3] 未找到模型目录，跳过（先在软件内触发一次下载/嵌入）")
        return None
    OUT.mkdir(exist_ok=True)
    zp = OUT / "bge-m3.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(cand.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(cand))
    print(f"[bge-m3] 打包 → {zp}")
    return zp


def main() -> int:
    names = sys.argv[1:] or [*SPECS, "bge-m3"]
    for n in names:
        if n in SPECS:
            build_pip_zip(n, SPECS[n])
        elif n == "bge-m3":
            build_bge_zip()
        else:
            print(f"未知组件: {n}")
    print(f"完成。产物目录：{OUT}")
    print("上传：gh release upload components-v1 dist_components/*.zip "
          "--repo lulutiyazejin/debate-engine --clobber")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
