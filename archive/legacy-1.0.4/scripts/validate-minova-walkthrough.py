from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageStat


ROOT = Path(__file__).resolve().parents[1]
WALKTHROUGH = ROOT / "showcase" / "minova-1.0.3-walkthrough"
MANIFEST = WALKTHROUGH / "manifest.json"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    missing: list[str] = []
    near_blank: list[dict] = []
    dimensions: list[tuple[int, int]] = []

    for entry in manifest["entries"]:
        screenshot = WALKTHROUGH / entry["file"]
        if not screenshot.is_file():
            missing.append(entry["file"])
            continue
        with Image.open(screenshot) as image:
            rgb = image.convert("RGB")
            dimensions.append(rgb.size)
            sample = rgb.resize((64, 64), Image.Resampling.BILINEAR)
            variation = sum(ImageStat.Stat(sample).stddev) / 3
            if variation < 2:
                near_blank.append({
                    "file": entry["file"],
                    "variation": round(variation, 3),
                })

    expected = int(manifest["count"])
    result = {
        "manifestCount": expected,
        "screenshotsFound": len(dimensions),
        "missing": missing,
        "nearBlank": near_blank,
        "smallestPixelArea": min(width * height for width, height in dimensions),
        "largestPixelArea": max(width * height for width, height in dimensions),
        "contactSheet": Image.open(WALKTHROUGH / "Minova-1.0.3-Contact-Sheet.png").size,
        "poster": Image.open(WALKTHROUGH / "Minova-1.0.3-Walkthrough-Cover.png").size,
        "videoBytes": (WALKTHROUGH / "Minova-1.0.3-Visual-Walkthrough.mp4").stat().st_size,
    }
    print(json.dumps(result, indent=2))
    if missing or near_blank or len(dimensions) != expected:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
