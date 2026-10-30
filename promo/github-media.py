#!/usr/bin/env python3
"""Derive GitHub page images from the committed, deterministic client demo.

Optional tooling only: Python 3 + Pillow. No app or server is launched.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "docs" / "media"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def font(size, bold=False):
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


def rounded_image(canvas, image, xy, radius):
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1), radius=radius, fill=255
    )
    canvas.paste(image, xy, mask)


def main():
    # Exact app-window bounds from LiveReplicaScene in CodexReplicaPromo.tsx.
    # Exclude the surrounding LIVE/MATCHED promotional rail.
    source = Image.open(MEDIA / "codex-replica-parity.png").convert("RGB")
    window = source.crop((96, 54, 1824, 1026))
    preview = window.resize((1600, 900), Image.Resampling.LANCZOS)
    preview.save(MEDIA / "codex-app-preview.png", optimize=True)

    cover = Image.new("RGB", (1280, 640), "#101414")
    draw = ImageDraw.Draw(cover)
    text = "#f1f5f3"
    muted = "#a7b9b2"
    accent = "#81d7ad"

    draw.rounded_rectangle((52, 48, 260, 86), radius=19, fill="#1e2e27")
    draw.text((70, 56), "codex-app / macOS", font=font(20, True), fill=accent)
    draw.text((52, 127), "Codex,", font=font(62, True), fill=text)
    draw.text((52, 202), "made editable.", font=font(54, True), fill=text)
    draw.text((54, 299), "Explore the desktop client.", font=font(23), fill=muted)
    draw.text((54, 335), "Build your own experience.", font=font(23), fill=muted)

    draw.rounded_rectangle((52, 402, 376, 442), radius=9, fill="#202925")
    draw.text((69, 412), "Electron  /  React  /  TypeScript", font=font(19), fill=text)

    shot = preview.resize((710, 399), Image.Resampling.LANCZOS)
    draw.rounded_rectangle((498, 97, 1220, 510), radius=19, fill="#30433a")
    rounded_image(cover, shot, (504, 103), 14)
    draw.text((510, 518), "Running client · deterministic demo data", font=font(16), fill=muted)

    draw.line((52, 562, 1220, 562), fill="#304039", width=1)
    draw.text((52, 583), "Streaming chats  ·  Workspace & diffs  ·  Terminals & agents", font=font(21), fill=text)
    draw.text((914, 587), "github.com/keriae/codex-app", font=font(17), fill=accent)
    cover.save(MEDIA / "github-social-preview.png", optimize=True)

    for name in ("codex-app-preview.png", "github-social-preview.png"):
        path = MEDIA / name
        print(f"{name}: {Image.open(path).size}, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
