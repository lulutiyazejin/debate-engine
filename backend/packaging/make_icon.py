r"""D11：四书堆应用图标（纸感色板，Pillow 绘制，决策7 自绘不依赖素材库）。
运行：backend\.venv\Scripts\python.exe backend/packaging/make_icon.py
产物：desktop/src-tauri/icons/ 下 icon.ico + 各尺寸 png（覆盖旧图标）。
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "desktop" / "src-tauri" / "icons"

PAPER = (232, 230, 225, 255)      # #e8e6e1 纸灰
INK = (26, 26, 26, 255)           # #1a1a1a 碳黑
INK2 = (58, 56, 52, 255)
INK3 = (96, 92, 86, 255)
ACCENT = (138, 36, 34, 255)       # #8a2422 唯一强调红

S = 1024


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 纸底圆角方
    d.rounded_rectangle([64, 64, S - 64, S - 64], radius=176, fill=PAPER)
    # 四本书自下而上叠放，横向略错位（手作感）；第三本 = 强调红
    books = [
        (196, 832, 690, 806, INK),
        (238, 796, 580, 674, INK3),
        (172, 816, 470, 564, ACCENT),
        (256, 776, 360, 454, INK2),
    ]
    for x0, x1, y0, y1, c in books:
        d.rounded_rectangle([x0, y0, x1, y1], radius=16, fill=c)
        # 书口：右端一条纸色细带
        d.rectangle([x1 - 30, y0 + 14, x1 - 16, y1 - 14], fill=PAPER)
    return img


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    img = draw()
    img.save(ICONS / "icon.png")
    for n, name in [(32, "32x32.png"), (128, "128x128.png"),
                    (256, "128x128@2x.png")]:
        img.resize((n, n), Image.LANCZOS).save(ICONS / name)
    img.resize((256, 256), Image.LANCZOS).save(
        ICONS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
               (64, 64), (128, 128), (256, 256)])
    print("icons written to", ICONS)


if __name__ == "__main__":
    main()
