"""版本号覆盖脚本（0.1.3 B17）：一参改三处。"""
import sys, re, json
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python bump-version.py <version>")
        return
    v = sys.argv[1].lstrip('v')
    root = Path(__file__).resolve().parent.parent   # backend/ → 项目根
    # 1) config.py VERSION = "x.y.z"
    f = root / "backend" / "config.py"
    t = f.read_text(encoding="utf-8")
    t = re.sub(r'^(VERSION\s*=\s*)"[^"]+"$', fr'\g<1>"{v}"', t, flags=re.MULTILINE)
    f.write_text(t, encoding="utf-8")
    print(f"✓ {f}")
    # 2) desktop/src-tauri/tauri.conf.json
    c = root / "desktop" / "src-tauri" / "tauri.conf.json"
    d = json.loads(c.read_text(encoding="utf-8"))
    d["version"] = v
    c.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ {c}")
    # 3) backend/packaging/installer.nsi (APP_VERSION)
    i = root / "backend" / "packaging" / "installer.nsi"
    t = i.read_text(encoding="utf-8")
    t = re.sub(r'(!define\s+APP_VERSION)\s+\S+', r'\g<1> "{}"'.format(v), t)
    i.write_text(t, encoding="utf-8")
    print(f"✓ {i}")
    print("Done.")

if __name__ == "__main__":
    main()
