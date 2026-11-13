"""Make Lefi Crop mobile's app icons from the brand mark (the same logo as Lefi Desktop's icon).

Usage: python3 scripts/dev/mobile-icons.py   (needs Pillow)

Source: assets/brand/logo-mark.png (approved brand artwork). iOS icons cannot be transparent, so the
mark is centred on white with a margin; Android gets the same square icon per density.
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MARK = ROOT / "assets/brand/logo-mark.png"
APP = ROOT / "apps/lefi-mobile"
IOS = APP / "ios/Runner/Assets.xcassets/AppIcon.appiconset"
ANDROID = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
MARGIN = 0.12  # share of the side left white around the mark


def square(size: int) -> Image.Image:
    mark = Image.open(MARK).convert("RGBA")
    inner = round(size * (1 - 2 * MARGIN))
    scale = inner / max(mark.size)
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas.convert("RGB")


def main() -> None:
    master = square(1024)
    contents = json.loads((IOS / "Contents.json").read_text())
    for img in contents["images"]:
        name = img.get("filename")
        if not name:
            continue
        side = float(img["size"].split("x")[0]) * int(img["scale"].rstrip("x"))
        master.resize((round(side), round(side)), Image.LANCZOS).save(IOS / name, optimize=True)
        print("ios", name, round(side))
    for density, side in ANDROID.items():
        out = APP / f"android/app/src/main/res/mipmap-{density}/ic_launcher.png"
        master.resize((side, side), Image.LANCZOS).save(out, optimize=True)
        print("android", density, side)


if __name__ == "__main__":
    main()
