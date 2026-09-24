#!/usr/bin/env python3
"""
Prepare a built site for GitHub Pages (run by publish.sh):

- leave out sound libraries whose licence doesn't allow publishing
  (LICENCES in scripts/libraries/build.py)
- convert library audio to FLAC: lossless, so loops stay gapless, at about
  half the size of WAV (needs macOS afconvert; otherwise WAV is kept)
- rewrite index.json and CREDITS.txt for what remains
- add .nojekyll, without which Pages' Jekyll step drops the _astro/ folder

    python3 scripts/pages/package.py <built-site-folder>
"""

import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "libraries"))
import build  # noqa: E402


# GitHub Pages refuses sites over 1 GB; stay clear of the edge
PAGES_LIMIT = 950e6


def to_flac(wav):
    subprocess.run(
        ["afconvert", "-f", "flac", "-d", "flac", str(wav), str(wav.with_suffix(".flac"))],
        check=True, capture_output=True,
    )
    wav.unlink()


def main(site):
    libraries = site / "libraries"
    if libraries.exists():
        for manifest in sorted(libraries.glob("*/library.json")):
            m = json.loads(manifest.read_text())
            if not m.get("publishable"):
                shutil.rmtree(manifest.parent)
                print(f"  left out {m['name']} ({m.get('licenceShort', 'licence unclear')})")
                continue
            wavs = sorted((manifest.parent / "audio").glob("*.wav"))
            if wavs and shutil.which("afconvert"):
                with ThreadPoolExecutor(8) as pool:
                    list(pool.map(to_flac, wavs))
                for sound in m["sounds"]:
                    if (sound.get("src") or "").endswith(".wav"):
                        sound["src"] = sound["src"][:-4] + ".flac"
                manifest.write_text(json.dumps(m))
            size = sum(f.stat().st_size for f in manifest.parent.rglob("*") if f.is_file())
            print(f"  {m['name']}: {m['count']} sounds, {size / 1e6:.0f} MB")
        build.write_index(libraries)

    (site / ".nojekyll").write_text("")

    total = sum(f.stat().st_size for f in site.rglob("*") if f.is_file())
    print(f"  site: {total / 1e6:.0f} MB")
    if total > PAGES_LIMIT:
        sys.exit(f"  too big for GitHub Pages ({PAGES_LIMIT / 1e6:.0f} MB limit): leave a library out")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
