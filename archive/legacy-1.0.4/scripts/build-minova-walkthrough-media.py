from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.3"
WALKTHROUGH = ROOT / "showcase" / f"minova-{VERSION}-walkthrough"
MANIFEST = WALKTHROUGH / "manifest.json"
FRAMES = WALKTHROUGH / ".video-frames"
VIDEO = WALKTHROUGH / f"Minova-{VERSION}-Visual-Walkthrough.mp4"
CONTACT_SHEET = WALKTHROUGH / f"Minova-{VERSION}-Contact-Sheet.png"
POSTER = WALKTHROUGH / f"Minova-{VERSION}-Walkthrough-Cover.png"
TOOLS = ROOT / ".media-tools"

CANVAS = (1920, 1080)
BACKGROUND = "#0a1018"
SURFACE = "#101a27"
BORDER = "#2b3a4d"
TEXT = "#f5f8fc"
MUTED = "#9eb2c8"
ACCENT = "#18c7be"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "seguisb.ttf" if bold else "segoeui.ttf"
    path = Path("C:/Windows/Fonts") / filename
    return ImageFont.truetype(str(path), size)


def fit_image(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = source.convert("RGB")
    fitted = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    return fitted


def add_frame(entry: dict, index: int) -> Path:
    canvas = Image.new("RGB", CANVAS, BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    source = Image.open(WALKTHROUGH / entry["file"])
    preview = fit_image(source, (1780, 790))

    preview_x = (CANVAS[0] - preview.width) // 2
    preview_y = 122 + (790 - preview.height) // 2
    frame_box = (
        preview_x - 10,
        preview_y - 10,
        preview_x + preview.width + 10,
        preview_y + preview.height + 10,
    )
    draw.rounded_rectangle(frame_box, radius=8, fill=SURFACE, outline=BORDER, width=2)
    canvas.paste(preview, (preview_x, preview_y))

    number = f"{entry['number']:02d}"
    draw.text((70, 40), number, fill=ACCENT, font=font(26, bold=True))
    draw.text((132, 36), entry["title"], fill=TEXT, font=font(36, bold=True))
    category_width = draw.textbbox((0, 0), entry["category"], font=font(20, bold=True))[2]
    draw.rounded_rectangle(
        (CANVAS[0] - category_width - 126, 42, CANVAS[0] - 70, 82),
        radius=6,
        fill="#142537",
        outline=BORDER,
    )
    draw.text(
        (CANVAS[0] - category_width - 98, 49),
        entry["category"],
        fill=ACCENT,
        font=font(20, bold=True),
    )

    description_lines = textwrap.wrap(entry["description"], width=112)[:2]
    draw.text(
        (70, 962),
        "\n".join(description_lines),
        fill=MUTED,
        font=font(23),
        spacing=6,
    )
    draw.text(
        (CANVAS[0] - 300, 1004),
        f"MINOVA CHROMIUM {VERSION}",
        fill="#61758d",
        font=font(17, bold=True),
    )

    destination = FRAMES / f"{index:03d}.png"
    canvas.save(destination, optimize=True)
    return destination


def build_contact_sheet(entries: list[dict]) -> None:
    columns = 3
    tile_width = 600
    tile_height = 390
    rows = math.ceil(len(entries) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)

    for index, entry in enumerate(entries):
        column = index % columns
        row = index // columns
        x = column * tile_width
        y = row * tile_height
        source = Image.open(WALKTHROUGH / entry["file"])
        preview = fit_image(source, (550, 290))
        preview_x = x + (tile_width - preview.width) // 2
        preview_y = y + 50 + (290 - preview.height) // 2
        draw.rounded_rectangle(
            (x + 16, y + 16, x + tile_width - 16, y + tile_height - 16),
            radius=8,
            fill=SURFACE,
            outline=BORDER,
            width=2,
        )
        sheet.paste(preview, (preview_x, preview_y))
        draw.text((x + 30, y + 26), f"{entry['number']:02d}", fill=ACCENT, font=font(19, bold=True))
        title = textwrap.shorten(entry["title"], width=45, placeholder="...")
        draw.text((x + 72, y + 24), title, fill=TEXT, font=font(21, bold=True))
        draw.text((x + 30, y + 350), entry["category"], fill=MUTED, font=font(16, bold=True))

    sheet.save(CONTACT_SHEET, optimize=True)


def build_poster(entries: list[dict]) -> None:
    canvas = Image.new("RGB", CANVAS, BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    logo = Image.open(ROOT / "assets" / "logos" / "minova-browser.png").convert("RGBA")
    logo.thumbnail((150, 150), Image.Resampling.LANCZOS)
    canvas.paste(logo, (130, 180), logo)
    draw.text((130, 370), "MINOVA CHROMIUM", fill=ACCENT, font=font(24, bold=True))
    draw.text((130, 420), "Visual walkthrough", fill=TEXT, font=font(72, bold=True))
    draw.multiline_text(
        (130, 530),
        f"{len(entries)} screens covering setup, interfaces, workspaces,\nmenus, settings, media, and protected streaming.",
        fill=MUTED,
        font=font(30),
        spacing=12,
    )
    draw.rounded_rectangle((130, 720, 645, 790), radius=7, fill=ACCENT)
    draw.text((168, 735), f"MINOVA {VERSION}  /  90 SECONDS", fill="#071017", font=font(25, bold=True))
    draw.text((130, 945), "BROWSE YOUR WAY.", fill="#526981", font=font(19, bold=True))
    canvas.save(POSTER, optimize=True)


def locate_ffmpeg() -> str:
    sys.path.insert(0, str(TOOLS))
    try:
        import imageio_ffmpeg
    except ImportError as error:
        raise RuntimeError(
            "imageio-ffmpeg is missing. Install it into .media-tools before building the video."
        ) from error
    return imageio_ffmpeg.get_ffmpeg_exe()


def build_video() -> None:
    ffmpeg = locate_ffmpeg()
    command = [
        ffmpeg,
        "-y",
        "-framerate",
        "0.4",
        "-start_number",
        "1",
        "-i",
        str(FRAMES / "%03d.png"),
        "-vf",
        "fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        str(VIDEO),
    ]
    subprocess.run(command, check=True)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = manifest["entries"]
    if manifest.get("count") != len(entries):
        raise RuntimeError("The walkthrough manifest count is inconsistent.")

    shutil.rmtree(FRAMES, ignore_errors=True)
    FRAMES.mkdir(parents=True)
    build_poster(entries)
    shutil.copyfile(POSTER, FRAMES / "001.png")
    for index, entry in enumerate(entries, start=2):
        source = WALKTHROUGH / entry["file"]
        if not source.is_file():
            raise FileNotFoundError(source)
        add_frame(entry, index)

    build_contact_sheet(entries)
    build_video()
    shutil.rmtree(FRAMES)
    print(json.dumps({
        "screenshots": len(entries),
        "contactSheet": str(CONTACT_SHEET),
        "poster": str(POSTER),
        "video": str(VIDEO),
        "videoBytes": VIDEO.stat().st_size,
    }, indent=2))


if __name__ == "__main__":
    main()
