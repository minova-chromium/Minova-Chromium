from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".media-tools"
PYTHON_PACKAGES = TOOLS / "python"
DEFAULT_VOICE = "en-US-AvaNeural"

sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(PYTHON_PACKAGES))

import edge_tts
import imageio_ffmpeg


async def render_voiceover(
    scenes_path: Path,
    output_directory: Path,
    voice_name: str,
) -> list[dict]:
    scenes = json.loads(scenes_path.read_text(encoding="utf-8"))
    output_directory.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    rendered: list[dict] = []

    for index, scene in enumerate(scenes, start=1):
        stem = f"scene-{index:02d}"
        compressed_audio = output_directory / f"{stem}.mp3"
        destination = output_directory / f"{stem}.wav"

        narrator = edge_tts.Communicate(
            text=scene["voiceover"],
            voice=voice_name,
            rate="-2%",
            pitch="+0Hz",
            volume="+0%",
        )
        await narrator.save(str(compressed_audio))

        # Store production audio as uncompressed 48 kHz PCM for predictable editing.
        subprocess.run(
            [
                ffmpeg,
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(compressed_audio),
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(destination),
            ],
            check=True,
        )
        compressed_audio.unlink(missing_ok=True)

        rendered.append(
            {
                "scene": index,
                "title": scene["title"],
                "file": str(destination),
                "bytes": destination.stat().st_size,
                "voice": voice_name,
            }
        )

    return rendered


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenes", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = asyncio.run(
        render_voiceover(
            scenes_path=args.scenes.resolve(),
            output_directory=args.output.resolve(),
            voice_name=args.voice,
        )
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
