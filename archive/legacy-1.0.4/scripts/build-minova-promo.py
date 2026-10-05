from __future__ import annotations

import json
import shutil
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.3"
WALKTHROUGH = ROOT / "showcase" / f"minova-{VERSION}-walkthrough"
PROMO = ROOT / "showcase" / f"minova-{VERSION}-promo"
SCENES_JSON = PROMO / "scenes.json"
SCENE_IMAGES = PROMO / "scenes"
VOICE = PROMO / "voiceover"
VIDEO = PROMO / f"Minova-Chromium-{VERSION}-Promo.mp4"
VOICE_TRACK = PROMO / f"Minova-Chromium-{VERSION}-Voiceover.wav"
SUBTITLES = PROMO / f"Minova-Chromium-{VERSION}-Promo.srt"
POSTER = PROMO / f"Minova-Chromium-{VERSION}-Promo-Cover.png"
TOOLS = ROOT / ".media-tools"
VOICEOVER_SCRIPT = ROOT / "scripts" / "render-minova-neural-voiceover.py"
VOICE_NAME = "en-US-AvaNeural"

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TRANSITION = 0.85

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
}

SCENES = [
    {
        "title": "Meet Minova Chromium",
        "subtitle": "A focused Windows browser, shaped around you.",
        "voiceover": "Meet Minova Chromium. A focused Windows browser, built around the way you actually browse.",
        "layout": "cover",
        "direction": "center",
    },
    {
        "title": "Start with your interface",
        "subtitle": "Choose Workspace UI or the familiar Classic UI.",
        "voiceover": "On first launch, choose the interface that fits you. Use Workspace UI for deep organization, or Classic UI for a familiar horizontal tab bar.",
        "layout": "full",
        "assets": ["09-first-launch-choose-interface.png"],
        "direction": "right",
    },
    {
        "title": "Contexts, not clutter",
        "subtitle": "Keep Personal, Work, Gaming, and custom spaces separate.",
        "voiceover": "Workspace UI keeps tabs inside color-coded contexts, so personal browsing, work, gaming, and anything you create stay neatly separated.",
        "layout": "full",
        "assets": ["13-workspace-ui-expanded-sidebar.png"],
        "direction": "left",
    },
    {
        "title": "More page when you need it",
        "subtitle": "Collapse the sidebar into a compact workspace rail.",
        "voiceover": "Need more room? Collapse the sidebar into a compact rail, then bring every workspace and tab back with one click.",
        "layout": "compare",
        "assets": [
            "13-workspace-ui-expanded-sidebar.png",
            "14-workspace-ui-collapsed-sidebar.png",
        ],
        "labels": ["Expanded", "Collapsed"],
        "direction": "right",
    },
    {
        "title": "Two live pages. One window.",
        "subtitle": "Split View keeps both Chromium tabs active and within reach.",
        "voiceover": "Split View places two live Chromium pages side by side, without opening another window or losing either tab.",
        "layout": "full",
        "assets": ["17-workspace-ui-split-view.png"],
        "direction": "left",
    },
    {
        "title": "Classic when you want it",
        "subtitle": "Traditional horizontal tabs, with every Minova tool intact.",
        "voiceover": "Prefer the traditional browser layout? Switch to Classic UI at any time, while keeping every Minova feature.",
        "layout": "full",
        "assets": ["18-classic-ui-horizontal-tabs.png"],
        "direction": "right",
    },
    {
        "title": "Make every color yours",
        "subtitle": "Customize the browser background, toolbar, text, borders, and accents.",
        "voiceover": "Make Minova yours with full theme control, from the background and toolbar to text, borders, accents, and warnings.",
        "layout": "full",
        "assets": ["27-settings-appearance.png"],
        "direction": "left",
    },
    {
        "title": "Power tools, close at hand",
        "subtitle": "Compatible Chrome extensions, pinned actions, and a refined quick menu.",
        "voiceover": "Install compatible Chrome extensions, pin their actions, and reach history, bookmarks, downloads, updates, and tools from the refined quick menu.",
        "layout": "overlay",
        "assets": [
            "26-extensions-manage-and-pin.png",
            "20-menu-main-controls.png",
        ],
        "direction": "right",
    },
    {
        "title": "Passwords stay protected",
        "subtitle": "Import into a Windows-encrypted vault with site-matched autofill.",
        "voiceover": "Minova can import Google Password Manager exports into a Windows-encrypted local vault and offer matching logins only on the right site.",
        "layout": "full",
        "assets": ["23-passwords-and-autofill.png"],
        "direction": "left",
    },
    {
        "title": "Media that works around you",
        "subtitle": "Boost quiet audio and keep supported video above other apps.",
        "voiceover": "Boost quiet browser audio, open supported video in an always-on-top player, and keep media controls close without interrupting your workflow.",
        "layout": "media",
        "assets": [
            "32-media-volume-booster.png",
            "36-media-always-on-top-popout.png",
        ],
        "labels": ["Volume booster", "Always-on-top popout"],
        "direction": "right",
    },
    {
        "title": "Protected streaming, attached",
        "subtitle": "Supported services play beneath Minova's own browser controls.",
        "voiceover": "For supported services, Streaming Mode adds a protected playback surface beneath Minova's own browser controls.",
        "layout": "full",
        "assets": ["34-streaming-embedded-protected-playback.png"],
        "direction": "left",
    },
    {
        "title": "Browse your way.",
        "subtitle": "Fast. Personal. Built for focus.",
        "voiceover": "Fast. Personal. Built for focus. Minova Chromium. Browse your way.",
        "layout": "end",
        "direction": "center",
    },
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "seguisb.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / filename), size)


def rounded_mask(size: tuple[int, int], radius: int = 8) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def contain(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.contain(source.convert("RGB"), size, Image.Resampling.LANCZOS)


def add_shadow(canvas: Image.Image, box: tuple[int, int, int, int], radius: int = 20) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=8, fill=(0, 0, 0, 150))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    canvas.alpha_composite(layer)


def paste_card(
    canvas: Image.Image,
    image: Image.Image,
    box: tuple[int, int, int, int],
    *,
    padding: int = 10,
) -> None:
    x1, y1, x2, y2 = box
    width = x2 - x1
    height = y2 - y1
    add_shadow(canvas, (x1 + 5, y1 + 12, x2 + 5, y2 + 12), 22)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(box, radius=8, fill=COLORS["surface"], outline=COLORS["border"], width=2)
    fitted = contain(image, (width - padding * 2, height - padding * 2))
    paste_x = x1 + (width - fitted.width) // 2
    paste_y = y1 + (height - fitted.height) // 2
    canvas.paste(fitted, (paste_x, paste_y), rounded_mask(fitted.size, 5))


def draw_header(canvas: Image.Image, title: str, subtitle: str, number: int) -> None:
    draw = ImageDraw.Draw(canvas)
    draw.text((92, 48), "MINOVA CHROMIUM", fill=COLORS["accent"], font=font(20, True))
    draw.text((92, 89), title, fill=COLORS["text"], font=font(48, True))
    draw.text((94, 151), subtitle, fill=COLORS["muted"], font=font(25))
    draw.text((1760, 56), f"{number:02d}", fill="#476078", font=font(22, True))
    draw.rounded_rectangle((92, 196, 1828, 201), radius=2, fill=COLORS["border"])
    progress = int(1736 * number / len(SCENES))
    draw.rounded_rectangle((92, 196, 92 + progress, 201), radius=2, fill=COLORS["accent"])


def cover_scene(end: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    logo = Image.open(ROOT / "assets" / "logos" / "minova-browser.png").convert("RGBA")
    logo.thumbnail((180, 180), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (142, 174))
    draw.text((142, 398), "MINOVA CHROMIUM", fill=COLORS["accent"], font=font(26, True))
    if end:
        draw.text((142, 463), "Browse your way.", fill=COLORS["text"], font=font(82, True))
        draw.text((145, 575), "Fast. Personal. Built for focus.", fill=COLORS["muted"], font=font(32))
        draw.rounded_rectangle((142, 690, 568, 762), radius=7, fill=COLORS["accent"])
        draw.text((188, 706), "MINOVA CHROMIUM", fill="#061016", font=font(26, True))
        draw.text((142, 927), "GPL-3.0  /  WINDOWS", fill="#506a82", font=font(18, True))
    else:
        draw.text((142, 463), "A browser shaped", fill=COLORS["text"], font=font(76, True))
        draw.text((142, 552), "around you.", fill=COLORS["text"], font=font(76, True))
        draw.text((145, 673), "Workspaces. Personalization. Protected streaming.", fill=COLORS["muted"], font=font(29))
        tags = ["CHROMIUM", "WORKSPACES", "SPLIT VIEW", "STREAMING"]
        x = 142
        for tag in tags:
            width = ImageDraw.Draw(canvas).textbbox((0, 0), tag, font=font(16, True))[2] + 46
            draw.rounded_rectangle((x, 786, x + width, 834), radius=6, fill=COLORS["surface_alt"], outline=COLORS["border"])
            draw.text((x + 23, 799), tag, fill=COLORS["accent"], font=font(16, True))
            x += width + 12
    return canvas


def render_scene(scene: dict, number: int) -> Image.Image:
    if scene["layout"] == "cover":
        return cover_scene(False)
    if scene["layout"] == "end":
        return cover_scene(True)

    canvas = Image.new("RGBA", (WIDTH, HEIGHT), COLORS["background"])
    draw_header(canvas, scene["title"], scene["subtitle"], number)
    images = [Image.open(WALKTHROUGH / filename) for filename in scene["assets"]]

    if scene["layout"] == "full":
        paste_card(canvas, images[0], (92, 235, 1828, 1000))
    elif scene["layout"] == "compare":
        paste_card(canvas, images[0], (92, 270, 948, 950))
        paste_card(canvas, images[1], (972, 270, 1828, 950))
        draw = ImageDraw.Draw(canvas)
        for x, label, color in [
            (114, scene["labels"][0], COLORS["pink"]),
            (994, scene["labels"][1], COLORS["accent"]),
        ]:
            draw.rounded_rectangle((x, 226, x + 160, 263), radius=5, fill=COLORS["surface_alt"])
            draw.ellipse((x + 14, 239, x + 25, 250), fill=color)
            draw.text((x + 36, 234), label, fill=COLORS["text"], font=font(18, True))
    elif scene["layout"] == "overlay":
        paste_card(canvas, images[0], (92, 235, 1620, 1000))
        menu = contain(images[1], (310, 720))
        x = 1500
        y = 258
        add_shadow(canvas, (x - 10, y - 10, x + menu.width + 10, y + menu.height + 10), 26)
        canvas.paste(menu, (x, y), rounded_mask(menu.size, 7))
    elif scene["layout"] == "media":
        draw = ImageDraw.Draw(canvas)
        boxes = [(126, 300, 906, 890), (1014, 300, 1794, 890)]
        for image, box, label, color in zip(
            images,
            boxes,
            scene["labels"],
            [COLORS["accent"], COLORS["blue"]],
        ):
            paste_card(canvas, image, box, padding=32)
            label_width = draw.textbbox((0, 0), label, font=font(22, True))[2]
            x = box[0] + (box[2] - box[0] - label_width) // 2
            draw.ellipse((x - 34, 932, x - 18, 948), fill=color)
            draw.text((x, 924), label, fill=COLORS["text"], font=font(22, True))
    else:
        raise ValueError(f"Unknown layout: {scene['layout']}")
    return canvas


def wave_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as audio:
        return audio.getnframes() / audio.getframerate()


def render_voiceover() -> list[Path]:
    SCENES_JSON.write_text(json.dumps(SCENES, indent=2), encoding="utf-8")
    shutil.rmtree(VOICE, ignore_errors=True)
    VOICE.mkdir(parents=True)
    result = subprocess.run(
        [
            sys.executable,
            str(VOICEOVER_SCRIPT),
            "--scenes",
            str(SCENES_JSON),
            "--output",
            str(VOICE),
            "--voice",
            VOICE_NAME,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    report = json.loads(result.stdout)
    paths = [Path(item["file"]) for item in report]
    if len(paths) != len(SCENES) or any(not path.is_file() for path in paths):
        raise RuntimeError("The promotional voiceover did not render every scene.")
    return paths


def timecode(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole_seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def write_subtitles(durations: list[float]) -> None:
    blocks = []
    cursor = 0.0
    for index, (scene, duration) in enumerate(zip(SCENES, durations), start=1):
        start = cursor + 0.2
        end = min(cursor + duration - 0.35, start + duration)
        blocks.append(
            f"{index}\n{timecode(start)} --> {timecode(end)}\n"
            f"{scene['voiceover']}\n"
        )
        cursor += duration - (TRANSITION if index < len(SCENES) else 0)
    SUBTITLES.write_text("\n".join(blocks), encoding="utf-8")


def locate_ffmpeg() -> str:
    sys.path.insert(0, str(TOOLS))
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def scene_video_filter(index: int, duration: float) -> str:
    # Keep screenshots pixel-stable. The former per-frame zoom crop rounded its
    # coordinates unevenly and produced visible one-pixel micro-jitter.
    filters = (
        f"[{index}:v]scale={WIDTH}:{HEIGHT}:flags=lanczos,"
        f"trim=duration={duration:.3f},setpts=PTS-STARTPTS,"
        f"fps={FPS},format=yuv420p,settb=AVTB"
    )
    if index == 0:
        filters += ",fade=t=in:st=0:d=0.650"
    return f"{filters}[v{index}]"


def build_video(scene_images: list[Path], voice_paths: list[Path], durations: list[float]) -> None:
    ffmpeg = locate_ffmpeg()
    inputs: list[str] = []
    for scene_image in scene_images:
        inputs.extend(["-loop", "1", "-framerate", str(FPS), "-i", str(scene_image)])
    for voice_path in voice_paths:
        inputs.extend(["-i", str(voice_path)])

    filters: list[str] = []
    for index, (scene, duration) in enumerate(zip(SCENES, durations)):
        filters.append(scene_video_filter(index, duration))
        audio_index = len(SCENES) + index
        filters.append(
            f"[{audio_index}:a]adelay=200,apad=pad_dur={duration:.3f},"
            f"atrim=duration={duration:.3f},asetpts=PTS-STARTPTS[a{index}]"
        )

    video_label = "v0"
    audio_label = "a0"
    elapsed = durations[0]
    transitions = ["fade", "smoothleft", "dissolve", "smoothup"]
    for index in range(1, len(SCENES)):
        next_video = f"vx{index}"
        next_audio = f"ax{index}"
        offset = elapsed - TRANSITION
        transition_name = transitions[(index - 1) % len(transitions)]
        filters.append(
            f"[{video_label}][v{index}]xfade=transition={transition_name}:"
            f"duration={TRANSITION:.3f}:offset={offset:.3f}[{next_video}]"
        )
        filters.append(
            f"[{audio_label}][a{index}]acrossfade=d={TRANSITION:.3f}:"
            f"c1=tri:c2=tri[{next_audio}]"
        )
        video_label = next_video
        audio_label = next_audio
        elapsed += durations[index] - TRANSITION

    fade_duration = 0.65
    fade_start = max(0.0, elapsed - fade_duration)
    filters.append(
        f"[{video_label}]fade=t=out:st={fade_start:.3f}:"
        f"d={fade_duration:.3f},format=yuv420p[vout]"
    )
    filters.append(
        f"[{audio_label}]afade=t=out:st={fade_start:.3f}:"
        f"d={fade_duration:.3f},loudnorm=I=-16:TP=-1.5:LRA=11,"
        f"aresample=48000[aout]"
    )

    command = [
        ffmpeg,
        "-y",
        *inputs,
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "19",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        str(VIDEO),
    ]
    subprocess.run(command, check=True)


def export_voice_track(voice_paths: list[Path], durations: list[float]) -> None:
    ffmpeg = locate_ffmpeg()
    inputs: list[str] = []
    filters: list[str] = []
    for index, (path, duration) in enumerate(zip(voice_paths, durations)):
        inputs.extend(["-i", str(path)])
        filters.append(
            f"[{index}:a]adelay=200,apad=pad_dur={duration:.3f},"
            f"atrim=duration={duration:.3f},asetpts=PTS-STARTPTS[a{index}]"
        )
    label = "a0"
    for index in range(1, len(voice_paths)):
        next_label = f"ax{index}"
        filters.append(
            f"[{label}][a{index}]acrossfade=d={TRANSITION:.3f}:"
            f"c1=tri:c2=tri[{next_label}]"
        )
        label = next_label
    filters.append(f"[{label}]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            *inputs,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[aout]",
            "-c:a",
            "pcm_s16le",
            str(VOICE_TRACK),
        ],
        check=True,
    )


def main() -> None:
    PROMO.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(SCENE_IMAGES, ignore_errors=True)
    SCENE_IMAGES.mkdir(parents=True)

    scene_images = []
    for index, scene in enumerate(SCENES, start=1):
        image = render_scene(scene, index).convert("RGB")
        destination = SCENE_IMAGES / f"scene-{index:02d}.png"
        image.save(destination, optimize=True)
        scene_images.append(destination)
        if index == 1:
            image.save(POSTER, optimize=True)

    voice_paths = render_voiceover()
    durations = [max(4.8, wave_duration(path) + 1.0) for path in voice_paths]
    write_subtitles(durations)
    export_voice_track(voice_paths, durations)
    build_video(scene_images, voice_paths, durations)

    report = {
        "version": VERSION,
        "scenes": len(SCENES),
        "durationSeconds": round(sum(durations) - TRANSITION * (len(SCENES) - 1), 2),
        "voice": VOICE_NAME,
        "animation": "Pixel-stable scenes with eased crossfades",
        "video": str(VIDEO),
        "videoBytes": VIDEO.stat().st_size,
        "voiceTrack": str(VOICE_TRACK),
        "subtitles": str(SUBTITLES),
        "poster": str(POSTER),
        "sceneDurations": [round(duration, 2) for duration in durations],
    }
    (PROMO / "promo-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
