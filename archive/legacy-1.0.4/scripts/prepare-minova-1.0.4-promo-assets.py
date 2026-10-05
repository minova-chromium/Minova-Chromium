from __future__ import annotations

import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "showcase" / "minova-1.0.4-promo" / "source"
WIDTH = 1600
HEIGHT = 900

COLORS = {
    "background": "#09111a",
    "surface": "#111b28",
    "surface_alt": "#172333",
    "border": "#2b3c50",
    "text": "#f5f8fc",
    "muted": "#9fb3ca",
    "accent": "#18c7be",
    "blue": "#2f8df7",
    "pink": "#ef6f9a",
    "warning": "#f6b44f",
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "seguisb.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / filename), size)


def fit(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.contain(source.convert("RGB"), size, Image.Resampling.LANCZOS)


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    origin: tuple[int, int],
    *,
    width: int,
    size: int,
    color: str,
    bold: bool = False,
    spacing: int = 8,
) -> int:
    active_font = font(size, bold)
    approximate_characters = max(12, int(width / (size * 0.55)))
    lines = textwrap.wrap(text, width=approximate_characters)
    x, y = origin
    for line in lines:
        draw.text((x, y), line, fill=color, font=active_font)
        y += size + spacing
    return y


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, color: str) -> int:
    active_font = font(19, True)
    right = x + draw.textbbox((0, 0), text, font=active_font)[2] + 54
    draw.rounded_rectangle((x, y, right, y + 48), radius=7, fill=COLORS["surface_alt"], outline=COLORS["border"])
    draw.ellipse((x + 18, y + 18, x + 30, y + 30), fill=color)
    draw.text((x + 39, y + 11), text, fill=COLORS["text"], font=active_font)
    return right


def assistant_overview() -> None:
    raw = Image.open(SOURCE / "assistant-raw.png").convert("RGB")
    canvas = fit(raw, (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(canvas)

    # Replace the deliberately blank test webpage while preserving the real
    # browser chrome, workspace sidebar, and Assistant panel from the build.
    draw.rectangle((170, 64, 1343, 899), fill="#0c141f")
    draw.text((250, 154), "LOCAL INTELLIGENCE", fill=COLORS["accent"], font=font(22, True))
    draw.text((250, 205), "Understand the page", fill=COLORS["text"], font=font(52, True))
    draw.text((250, 267), "without sending it away.", fill=COLORS["text"], font=font(52, True))
    draw_wrapped(
        draw,
        "Minova's private assistant runs directly on your hardware and can work with the current page when you choose.",
        (254, 354),
        width=720,
        size=25,
        color=COLORS["muted"],
        spacing=10,
    )
    x = 254
    for label, color in [
        ("WEBGPU", COLORS["blue"]),
        ("OFFLINE CACHE", COLORS["accent"]),
        ("NO CLOUD API", COLORS["pink"]),
    ]:
        x = pill(draw, x, 488, label, color) + 14

    cards = [
        ("Summarize", "Turn long pages into a focused brief."),
        ("Explain", "Make selected text easier to understand."),
        ("Create", "Build quizzes, study guides, and replies."),
    ]
    for index, (title, description) in enumerate(cards):
        x1 = 254 + index * 330
        draw.rounded_rectangle((x1, 594, x1 + 304, 764), radius=8, fill=COLORS["surface"], outline=COLORS["border"], width=2)
        draw.text((x1 + 26, 621), title, fill=COLORS["text"], font=font(25, True))
        draw_wrapped(draw, description, (x1 + 26, 668), width=250, size=19, color=COLORS["muted"], spacing=7)

    canvas.save(SOURCE / "assistant-overview.png", optimize=True)


def assistant_tools() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    draw.text((84, 76), "ONE SIDEBAR. THIRTEEN PAGE TOOLS.", fill=COLORS["accent"], font=font(22, True))
    draw.text((84, 126), "Go from reading to doing.", fill=COLORS["text"], font=font(54, True))
    draw_wrapped(
        draw,
        "Use the current page or a selected passage, then choose the exact kind of help you need.",
        (88, 204),
        width=1100,
        size=25,
        color=COLORS["muted"],
    )

    tools = [
        "Summarize", "Key points", "Action items", "Explain selection",
        "Rewrite selection", "Study guide", "Create quiz", "Page outline",
        "Analyze claims", "Extract data", "Compare tabs", "Simplify",
        "Proofread", "Draft reply",
    ]
    for index, label in enumerate(tools):
        column = index % 3
        row = index // 3
        x1 = 88 + column * 500
        y1 = 330 + row * 92
        draw.rounded_rectangle((x1, y1, x1 + 458, y1 + 68), radius=7, fill=COLORS["surface"], outline=COLORS["border"], width=2)
        color = [COLORS["accent"], COLORS["blue"], COLORS["pink"]][column]
        draw.rounded_rectangle((x1 + 18, y1 + 18, x1 + 50, y1 + 50), radius=6, fill=color)
        draw.text((x1 + 70, y1 + 18), label, fill=COLORS["text"], font=font(22, True))

    canvas.save(SOURCE / "assistant-tools.png", optimize=True)


def local_pipeline() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    draw.text((84, 76), "PRIVATE BY ARCHITECTURE", fill=COLORS["accent"], font=font(22, True))
    draw.text((84, 126), "The model stays with you.", fill=COLORS["text"], font=font(54, True))
    draw_wrapped(
        draw,
        "After the first download, Minova caches the model for offline use and keeps inference on your GPU.",
        (88, 204),
        width=1100,
        size=25,
        color=COLORS["muted"],
    )

    nodes = [
        (100, "CURRENT PAGE", "Text you choose to share", COLORS["blue"]),
        (565, "WEBGPU", "Local model inference", COLORS["accent"]),
        (1030, "INDEXEDDB", "Offline model cache", COLORS["pink"]),
    ]
    for index, (x, title, subtitle, color) in enumerate(nodes):
        draw.rounded_rectangle((x, 380, x + 380, 650), radius=8, fill=COLORS["surface"], outline=COLORS["border"], width=2)
        draw.rounded_rectangle((x + 30, 414, x + 92, 476), radius=8, fill=color)
        draw.text((x + 30, 512), title, fill=COLORS["text"], font=font(27, True))
        draw_wrapped(draw, subtitle, (x + 30, 560), width=310, size=20, color=COLORS["muted"])
        if index < len(nodes) - 1:
            draw.line((x + 394, 515, x + 449, 515), fill=COLORS["accent"], width=5)
            draw.polygon(((x + 449, 515), (x + 431, 504), (x + 431, 526)), fill=COLORS["accent"])

    draw.rounded_rectangle((435, 740, 1165, 812), radius=7, fill="#10241f", outline="#1e5b52", width=2)
    draw.text((504, 758), "No account required  /  No cloud prompt  /  No background app", fill=COLORS["accent"], font=font(22, True))
    canvas.save(SOURCE / "local-pipeline.png", optimize=True)


def audio_studio() -> None:
    raw = Image.open(SOURCE / "audio-studio-raw.png").convert("RGB")
    canvas = Image.new("RGB", (WIDTH, HEIGHT), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    draw.text((82, 78), "MINOVA AUDIO STUDIO", fill=COLORS["accent"], font=font(22, True))
    draw.text((82, 128), "Make every tab sound right.", fill=COLORS["text"], font=font(52, True))
    draw_wrapped(
        draw,
        "Boost quiet media, smooth sudden volume changes, and shape sound with a fully adjustable ten-band parametric EQ.",
        (86, 218),
        width=650,
        size=25,
        color=COLORS["muted"],
        spacing=10,
    )
    features = [
        "Per-tab volume boost",
        "Transparent normalizer",
        "Ten adjustable EQ bands",
        "Automatic clipping headroom",
        "Local custom presets",
    ]
    for index, label in enumerate(features):
        y = 390 + index * 75
        draw.rounded_rectangle((88, y, 122, y + 34), radius=6, fill=COLORS["accent"])
        draw.text((145, y + 1), label, fill=COLORS["text"], font=font(24, True))

    popup = fit(raw, (720, 790))
    x = 825 + (710 - popup.width) // 2
    y = 55 + (790 - popup.height) // 2
    draw.rounded_rectangle((x - 13, y - 13, x + popup.width + 13, y + popup.height + 13), radius=8, fill=COLORS["surface"], outline=COLORS["border"], width=2)
    canvas.paste(popup, (x, y))
    canvas.save(SOURCE / "audio-studio.png", optimize=True)


def window_polish() -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    draw.text((84, 76), "INTERFACE POLISH", fill=COLORS["accent"], font=font(22, True))
    draw.text((84, 126), "The details behave like they should.", fill=COLORS["text"], font=font(52, True))
    draw_wrapped(
        draw,
        "Version 1.0.4 restores the compact Classic titlebar and makes every native window control reliably clickable.",
        (88, 206),
        width=1050,
        size=25,
        color=COLORS["muted"],
    )

    x1, y1, x2, y2 = 84, 350, 1516, 690
    draw.rounded_rectangle((x1, y1, x2, y2), radius=8, fill="#0d1520", outline=COLORS["border"], width=2)
    draw.rectangle((x1 + 2, y1 + 2, x2 - 2, y1 + 72), fill="#0a1018")
    logo = fit(Image.open(ROOT / "assets" / "logos" / "minova-browser.png"), (38, 38))
    canvas.paste(logo, (x1 + 22, y1 + 17))
    draw.text((x1 + 72, y1 + 21), "Minova", fill=COLORS["text"], font=font(22, True))

    tabs = [("Assistant guide", 210), ("Audio Studio", 430), ("New Tab", 630)]
    for index, (label, x) in enumerate(tabs):
        fill = "#1b2a3c" if index == 0 else "#121c29"
        draw.rounded_rectangle((x1 + x, y1 + 76, x1 + x + 200, y1 + 132), radius=7, fill=fill, outline=COLORS["border"])
        draw.text((x1 + x + 18, y1 + 92), label, fill=COLORS["text"], font=font(18))
    draw.text((x1 + 848, y1 + 83), "+", fill=COLORS["text"], font=font(28))

    control_x = x2 - 210
    controls = [("−", control_x), ("□", control_x + 70), ("×", control_x + 140)]
    for label, x in controls:
        draw.rectangle((x, y1 + 2, x + 70, y1 + 70), fill="#101924")
        draw.text((x + 25, y1 + 18), label, fill=COLORS["text"], font=font(25))

    draw.rounded_rectangle((x1 + 40, y1 + 170, x2 - 40, y1 + 228), radius=24, fill="#121d2b", outline=COLORS["border"])
    draw.text((x1 + 72, y1 + 187), "Search or enter web address", fill=COLORS["muted"], font=font(19))
    draw.text((x1 + 50, y2 - 71), "Classic tabs stay compact.  The + button stays beside your tabs.  Streaming geometry stays aligned.", fill=COLORS["muted"], font=font(20))

    labels = ["MINIMIZE", "MAXIMIZE / RESTORE", "CLOSE"]
    x = 250
    for label, color in zip(labels, [COLORS["blue"], COLORS["accent"], COLORS["pink"]]):
        x = pill(draw, x, 760, label, color) + 18
    canvas.save(SOURCE / "window-polish.png", optimize=True)


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    assistant_overview()
    assistant_tools()
    local_pipeline()
    audio_studio()
    window_polish()
    print(f"Prepared Minova 1.0.4 promotional assets in {SOURCE}")


if __name__ == "__main__":
    main()
