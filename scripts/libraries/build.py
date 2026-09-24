#!/usr/bin/env python3
"""
Fetch third-party sound libraries for the route visualiser.

    python3 scripts/libraries/build.py            # every library it can fetch
    python3 scripts/libraries/build.py emo isd    # just these
    python3 scripts/libraries/build.py custom path/to/folder

Raw downloads are cached in .cache/libraries/raw/. Each library is written to
public/libraries/<id>/ as audio plus a library.json manifest, and listed in
public/libraries/index.json, which the visualiser reads at runtime, with a
CREDITS.txt covering every installed library. Both folders are gitignored:
licences vary (some non-commercial only, one unstated), so a library is only
ever published deliberately, by scripts/pages/publish.sh, never by committing
it. See LICENCES below.

    python3 scripts/libraries/build.py refresh    # re-apply LICENCES, rewrite
                                                  # index.json and CREDITS.txt

Every library's ratings are converted to the engine's scale, valence and
arousal in -1..+1. How each conversion works is written into its manifest
(`coordinates`) and shown in the visualiser, because the libraries measure
different things and their positions are not strictly comparable.

Standard library only (Python 3.9+), so teammates need nothing installed.
"""

import csv
import io
import json
import math
import re
import shutil
import statistics
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import remote_zip
from audio import read_wav

# Added libraries are shifted as a whole so their median clip level matches
# Moodist's own sounds (measured: median -29.6 dBFS RMS). Each clip keeps its
# loudness relative to the rest of its library, which carries arousal; only
# the arbitrary recording level between libraries is removed.
MOODIST_MEDIAN_DB = -29.6

# Licence facts per library, applied to every manifest. `publishable` means
# it may go on a public, non-commercial site with the credits in CREDITS.txt.
LICENCES = {
    "emo-soundscapes": {
        "citation": "Fan, J., Thorogood, M., & Pasquier, P. (2017). Emo-Soundscapes: A dataset for soundscape emotion recognition. ACII 2017. Excerpts of Freesound recordings; per-clip credits below.",
        "licence": "Each clip keeps its Freesound licence (CC0, CC BY, CC BY-NC or Sampling+). All of these allow non-commercial sharing of excerpts with credit to the author.",
        "licenceShort": "Freesound CC, per clip",
        "publishable": True,
    },
    "nessti": {
        "citation": "Hocking, J., Dzafic, I., Kazovsky, M., & Copland, D. A. (2013). NESSTI: Norms for Environmental Sound Stimuli. PLOS ONE, 8(9), e73382.",
        "licence": "No licence is stated for the audio (described as freely available for research). Keep it local; ask the authors before publishing it.",
        "licenceShort": "No licence stated",
        "publishable": False,
    },
    "isd": {
        "citation": "Mitchell, A., et al. (2021). The International Soundscape Database. Zenodo, doi:10.5281/zenodo.10672568. CC BY 4.0. Recordings level-adjusted; one recording per location.",
        "licence": "CC BY 4.0: may be shared with credit, including changes made (levels adjusted).",
        "licenceShort": "CC BY 4.0",
        "publishable": True,
    },
    "araus": {
        "citation": "Ooi, K., et al. (2023). ARAUS: A large-scale dataset and baseline models of affective responses to augmented urban soundscapes. IEEE Transactions on Affective Computing. Data: doi:10.21979/N9/9OTEVX. CC BY-NC 4.0. Masker levels adjusted; positions derived from the published ratings.",
        "licence": "CC BY-NC 4.0: may be shared for non-commercial use with credit, including changes made (levels adjusted).",
        "licenceShort": "CC BY-NC 4.0",
        "publishable": True,
    },
}

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".cache" / "libraries" / "raw"
OUT = ROOT / "public" / "libraries"


# ---- helpers ---------------------------------------------------------------


def download(url, name):
    """Download once into the raw cache; returns the path."""
    RAW.mkdir(parents=True, exist_ok=True)
    dest = RAW / name
    if dest.exists():
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    print(f"  downloading {name} ...", flush=True)
    with urllib.request.urlopen(url) as response, open(part, "wb") as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    part.rename(dest)
    return dest


def level_match(clips):
    """clips: {key: Clip}. Shift the library's median to Moodist's; returns
    {key: (wav_bytes, seconds, original_db)}."""
    levels = {key: clip.rms_db() for key, clip in clips.items()}
    shift = MOODIST_MEDIAN_DB - statistics.median(levels.values())
    out = {}
    for key, clip in clips.items():
        clip.gain(shift)
        out[key] = (clip.to_wav(), round(clip.seconds, 2), round(levels[key], 1))
    print(f"  level shift {shift:+.1f} dB to match Moodist's median")
    return out, round(shift, 1)


def wav_seconds(data):
    return read_wav(data).seconds


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def spaced(camel):
    """RegentsParkJapan -> Regents Park Japan"""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", camel)


def clamp(x):
    return max(-1.0, min(1.0, x))


def iso_projection(r):
    """ISO/TS 12913-3 projection of the eight 1-5 attribute ratings onto
    pleasantness and eventfulness, each in -1..+1."""
    c = math.cos(math.radians(45))
    k = 4 + math.sqrt(32)
    p = ((r["pleasant"] - r["annoying"]) + c * (r["calm"] - r["chaotic"])
         + c * (r["vibrant"] - r["monotonous"])) / k
    e = ((r["eventful"] - r["uneventful"]) + c * (r["chaotic"] - r["calm"])
         + c * (r["vibrant"] - r["monotonous"])) / k
    return p, e


def write_library(meta, sounds):
    """Write library.json, then refresh index.json and CREDITS.txt."""
    folder = OUT / meta["id"]
    durations = [s["duration"] for s in sounds if s.get("duration")]
    meta = {
        **meta,
        **LICENCES.get(meta["id"], {}),
        "clipSeconds": round(statistics.median(durations), 1) if durations else None,
        "count": len(sounds),
        "sounds": sounds,
    }
    (folder / "library.json").write_text(json.dumps(meta, indent=1))
    print(f"  wrote {meta['id']}: {len(sounds)} sounds")
    write_index()


def write_index(root=OUT):
    """index.json and CREDITS.txt for every library.json under root."""
    manifests = [json.loads(p.read_text()) | {"_dir": p.parent.name}
                 for p in sorted(root.glob("*/library.json"))]
    index = [{"count": m["count"], "file": f"{m['_dir']}/library.json",
              "id": m["id"], "name": m["name"]} for m in manifests]
    (root / "index.json").write_text(json.dumps(index, indent=1))

    lines = [
        "Sound libraries: credits and licences",
        "=====================================",
        "",
        "Third-party sounds used by the route visualiser, for non-commercial",
        "research and teaching. Levels were adjusted so each library's median",
        "matches Moodist's own sounds; coordinates were derived from each",
        "source's published ratings as described below.",
        "",
    ]
    for m in manifests:
        lines += [
            m["name"],
            "-" * len(m["name"]),
            f"Source:      {m.get('source', '')}",
            f"Cite:        {m.get('citation', '')}",
            f"Licence:     {m.get('licence', '')}",
            f"Coordinates: {m.get('coordinates', '')}",
            "",
        ]
        credited = [s for s in m["sounds"] if s.get("credit") or s.get("url")]
        for sound in credited:
            parts = [sound["label"], sound.get("credit") or "", sound.get("licence") or "",
                     "" if sound.get("credit") and (sound.get("url") or "") in sound["credit"] else sound.get("url") or ""]
            lines.append("  " + " | ".join(p for p in parts if p))
        if credited:
            lines.append("")
    (root / "CREDITS.txt").write_text("\n".join(lines))


def refresh(root=OUT):
    """Re-apply LICENCES to installed manifests without re-downloading."""
    for path in sorted(root.glob("*/library.json")):
        m = json.loads(path.read_text())
        m.update(LICENCES.get(m["id"], {}))
        for sound in m["sounds"]:
            if sound.get("credit"):
                sound["credit"] = urllib.parse.unquote(sound["credit"])
        path.write_text(json.dumps(m, indent=1))
        print(f"  refreshed {m['id']}")
    write_index(root)


def audio_folder(library_id):
    folder = OUT / library_id / "audio"
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    return folder


def read_xlsx(data, sheet=1):
    """Rows of the first sheet of an .xlsx, without openpyxl."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    book = zipfile.ZipFile(io.BytesIO(data))
    strings = []
    if "xl/sharedStrings.xml" in book.namelist():
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        strings = ["".join(t.itertext()) for t in root.findall("m:si", ns)]
    root = ET.fromstring(book.read(f"xl/worksheets/sheet{sheet}.xml"))
    rows = []
    for row in root.find("m:sheetData", ns):
        cells = {}
        for cell in row:
            column = re.match(r"[A-Z]+", cell.get("r")).group()
            index = 0
            for ch in column:
                index = index * 26 + ord(ch) - 64
            value = cell.find("m:v", ns)
            if value is None:
                continue
            text = value.text
            cells[index - 1] = strings[int(text)] if cell.get("t") == "s" else text
        rows.append([cells.get(i, "") for i in range(max(cells, default=-1) + 1)])
    return rows


# ---- Emo-Soundscapes ---------------------------------------------------------


def build_emo():
    """Fan, Thorogood & Pasquier (2017). 600 six-second Freesound excerpts,
    crowd-ranked for valence and arousal. The 613 mixes are left out: they
    are combinations of these, useful for testing additivity, not as sources."""
    print("Emo-Soundscapes")
    raw = download(
        "https://drive.usercontent.google.com/download"
        "?id=1cfMgMssDc-ytedcITvM18nzWcBLeoZFz&export=download&confirm=t",
        "Emo-Soundscapes.zip",
    )
    z = zipfile.ZipFile(raw)
    root = "Emo-Soundscapes/"

    def lines(name):
        # the CSVs use old Mac (CR) line endings
        return z.read(name).decode("utf-8", "replace").splitlines()

    def ratings(axis):
        rows = csv.reader(lines(f"{root}Emo-Soundscapes-Ratings/{axis}.csv"))
        return {row[0].strip(): float(row[1]) for row in rows if len(row) > 1}

    valence, arousal = ratings("Valence"), ratings("Arousal")

    meta = {}
    for name in z.namelist():
        if name.startswith(f"{root}Emo-Soundscapes-Metadata/") and name.endswith(".csv"):
            for row in csv.DictReader(lines(name)):
                meta[row["FileName"].rsplit(".", 1)[0]] = row

    clips, info = {}, {}
    for name in sorted(z.namelist()):
        if "/600_Sounds/" not in name or not name.endswith(".wav") or "__MACOSX" in name:
            continue
        file = name.rsplit("/", 1)[1]
        if file in valence and file in arousal:
            clips[file] = read_wav(z.read(name))
            info[file] = name.split("/600_Sounds/")[1].split("/")[0]

    matched, shift = level_match(clips)
    folder = audio_folder("emo-soundscapes")
    sounds = []
    for file, (wav, seconds, level) in matched.items():
        (folder / file).write_bytes(wav)
        stem = file.rsplit(".", 1)[0]
        m = meta.get(stem, {})
        user = re.search(r"/people/([^/]+)/", m.get("FsUrl", ""))
        term = (m.get("SearchTerm") or info[file]).strip()
        sounds.append({
            "arousal": round(arousal[file], 4),
            "category": info[file],
            "credit": f"{urllib.parse.unquote(user.group(1))} (Freesound {m.get('FsID')})" if user else None,
            "duration": seconds,
            "id": f"emo:{stem}",
            "label": f"{term.capitalize()} · {m.get('FsID') or stem[-6:]}",
            "levelDb": level,
            "src": f"libraries/emo-soundscapes/audio/{file}",
            "url": m.get("FsUrl"),
            "valence": round(valence[file], 4),
        })

    write_library({
        "coordinates": "Crowdsourced pairwise rankings of all 1,213 clips (1,182 annotators), mapped by the authors onto -1..+1. Rank-based, so evenly spread by construction: relative, not absolute.",
        "id": "emo-soundscapes",
        "levelShiftDb": shift,
        "name": "Emo-Soundscapes",
        "source": "https://www.metacreation.net/projects/emo-soundscapes",
    }, sounds)


# ---- NESSTI ----------------------------------------------------------------


def build_nessti():
    """Hocking et al. (2013). 110 environmental sounds, each trimmed to one
    second, with SAM pleasantness and arousal norms."""
    print("NESSTI")
    raw = download("https://imaging.org.au/uploads/Nessti/NESSTI.zip", "nessti.zip")
    z = zipfile.ZipFile(raw)
    rows = read_xlsx(z.read("NESSTI/NESSTI_data_norms.xlsx"))
    col = {name: i for i, name in enumerate(rows[0])}

    # the sheet says "fire alarm", the file is firealarm.wav; "mosquito" is
    # mosquitos.wav and "whaleorca" is whale.wav
    compact = lambda text: re.sub(r"[^a-z]", "", text.lower())
    files = {compact(n[len("NESSTI/"):-4]): n for n in z.namelist()
             if n.endswith(".wav") and "__MACOSX" not in n}

    def member(name):
        key = compact(name)
        return files.get(key) or next(
            (f for k, f in files.items() if key.startswith(k) or k.startswith(key)), None)

    clips, norms = {}, {}
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        name = str(row[0]).strip()
        found = member(name)
        if not found:
            print(f"  no audio for {name}")
            continue
        clips[name] = read_wav(z.read(found))
        norms[name] = row

    matched, shift = level_match(clips)
    folder = audio_folder("nessti")
    sounds = []
    for name, (wav, seconds, level) in matched.items():
        row = norms[name]
        (folder / f"{slug(name)}.wav").write_bytes(wav)
        # SAM scales run 1 = most pleasant / most excited to 9 = the opposite
        pleasantness = float(row[col["PSNT_mean_S1"]])
        excitement = float(row[col["ARS_mean_S1"]])
        sounds.append({
            "arousal": round(clamp((5 - excitement) / 4), 4),
            "category": row[col["Category"]],
            "duration": seconds,
            "id": f"nessti:{slug(name)}",
            "label": name.capitalize(),
            "levelDb": level,
            "src": f"libraries/nessti/audio/{slug(name)}.wav",
            "valence": round(clamp((5 - pleasantness) / 4), 4),
        })

    write_library({
        "coordinates": "Mean SAM ratings on 1-9 scales (1 = most pleasant, 1 = most excited), n = 162, converted as (5 - mean) / 4.",
        "id": "nessti",
        "levelShiftDb": shift,
        "name": "NESSTI",
        "source": "https://imaging.org.au/Nessti/",
    }, sounds)


# ---- International Soundscape Database --------------------------------------

ISD = "https://zenodo.org/records/10672568/files/"
ISD_ZIPS = [
    "WAV_Groningen_1.zip", "WAV_Venice_1.zip", "WAV_Granada_1.zip",
    "WAV_London_1.zip", "WAV_London_2.zip", "WAV_London_3.zip", "WAV_London_4.zip",
]
PAQ = ["pleasant", "chaotic", "vibrant", "uneventful", "calm", "annoying", "eventful", "monotonous"]


def build_isd(per_location=1):
    """Mitchell et al. (2021). In-situ ISO 12913 surveys with 30-second
    binaural recordings. One recording per location, the one with the most
    respondents, placed at the location's mean rating: single responses are
    too noisy to place a sound on their own. Pulled from the remote zips with
    range requests instead of downloading ~17 GB."""
    print("International Soundscape Database")
    table = download(f"{ISD}ISD%20v1.0%20Data.csv?download=1", "isd-data.csv")
    rows = list(csv.DictReader(open(table, encoding="utf-8-sig")))

    by_location, by_group = {}, {}
    for row in rows:
        try:
            p, e = iso_projection({k: float(row[k]) for k in PAQ})
        except ValueError:
            continue
        by_location.setdefault(row["LocationID"], []).append((p, e))
        by_group.setdefault(row["GroupID"], []).append((p, e))

    clips, entries = {}, {}
    for zname in ISD_ZIPS:
        z = zipfile.ZipFile(remote_zip.open_remote(f"{ISD}{zname}?download=1"))
        members = {}
        for info in z.infolist():
            if "__MACOSX" in info.filename or not info.filename.lower().endswith(".wav"):
                continue
            parts = info.filename.split("/")
            stem = re.sub(r"(\.hdf)?\.wav$", "", parts[-1], flags=re.I)
            if stem not in by_group:
                continue
            # prefer the plain .wav when a .hdf.wav twin exists
            key = (parts[1], stem)
            if key not in members or ".hdf." in members[key].filename:
                members[key] = info

        for location in sorted({loc for loc, _ in members}):
            if location not in by_location:
                continue
            ranked = sorted(
                ((stem, info) for (loc, stem), info in members.items() if loc == location),
                key=lambda item: -len(by_group[item[0]]),
            )[:per_location]
            ratings = by_location[location]
            p = statistics.mean(r[0] for r in ratings)
            e = statistics.mean(r[1] for r in ratings)
            for stem, info in ranked:
                file = f"{slug(location)}-{slug(stem)}.wav"
                print(f"  {location}: {info.filename.rsplit('/', 1)[1]} ({info.file_size / 1e6:.1f} MB)", flush=True)
                clips[file] = read_wav(z.read(info))
                entries[file] = {
                    "arousal": round(clamp(e), 4),
                    "category": zname.replace("WAV_", "").split("_")[0],
                    "id": f"isd:{slug(location)}-{slug(stem)}",
                    "label": spaced(location),
                    "n": len(ratings),
                    "src": f"libraries/isd/audio/{file}",
                    "valence": round(clamp(p), 4),
                }

    matched, shift = level_match(clips)
    folder = audio_folder("isd")
    sounds = []
    for file, (wav, seconds, level) in matched.items():
        (folder / file).write_bytes(wav)
        sounds.append({**entries[file], "duration": seconds, "levelDb": level})

    write_library({
        "coordinates": "ISO/TS 12913-3 pleasantness and eventfulness (the ISO counterpart of arousal), each -1..+1, averaged over every survey at the location.",
        "id": "isd",
        "levelShiftDb": shift,
        "name": "International Soundscape Database",
        "source": "https://zenodo.org/records/10672568",
    }, sounds)


# ---- ARAUS -----------------------------------------------------------------

ARAUS = "https://researchdata.ntu.edu.sg/api/access/datafile/{}?gbrecs=true"


def build_araus():
    """Ooi et al. (2023). Urban soundscapes with one masker (bird, water,
    wind, traffic, construction) added at set loudness ratios, rated on the
    ISO attributes. A masker has no rating of its own, so it is placed at the
    mean rating of every stimulus it was added to, at the loudest ratio used.
    This is a proxy: it describes the masker in context, not alone.

    Audio comes from maskersv2.zip (the 112 maskers added in ARAUSv2, 222 MB)
    and, when downloaded, maskers.zip (the original 287, 587 MB). Once any
    audio is present, only maskers with audio are kept, so routes never pick
    a silent entry. Each masker keeps its own source licence; the one
    NoDerivatives masker is left out because levels are adjusted."""
    print("ARAUS")
    data = zipfile.ZipFile(download(ARAUS.format(114619), "araus-datav2.zip"))

    def table(suffix):
        name = next(n for n in data.namelist() if n.endswith(suffix) and "__MACOSX" not in n)
        return list(csv.DictReader(io.StringIO(data.read(name).decode("utf-8-sig"))))

    stem = lambda name: name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    maskers = {stem(row["masker"]): row for row in table("maskers.csv")}

    by_masker = {}
    for row in table("responses.csv"):
        masker = stem(row.get("masker", ""))
        info = maskers.get(masker, {})
        # skip silence, attention checks and the shared practice stimuli
        if (
            info.get("class") in (None, "silence")
            or "NoDerivs" in info.get("license", "")
            or row.get("is_attention") == "1"
            or row.get("fold_r") == "-1"
        ):
            continue
        try:
            ratings = {k: float(row[k]) for k in PAQ}
            smr = float(row["smr"])
        except (KeyError, ValueError):
            continue
        by_masker.setdefault(masker, []).append((smr, iso_projection(ratings)))

    clips = {}
    for archive in ("araus-maskersv2.zip", "araus-maskers.zip"):
        if not (RAW / archive).exists():
            continue
        z = zipfile.ZipFile(RAW / archive)
        for name in z.namelist():
            if name.lower().endswith(".wav") and "__MACOSX" not in name and stem(name) in by_masker:
                clips[stem(name)] = read_wav(z.read(name))

    matched, shift = ({}, None)
    if clips:
        matched, shift = level_match(clips)
        folder = audio_folder("araus")
        print(f"  audio for {len(clips)} of {len(by_masker)} rated maskers")
    else:
        (OUT / "araus").mkdir(parents=True, exist_ok=True)
        print("  masker audio not downloaded yet: writing coordinates only")

    sounds = []
    for masker, entries in sorted(by_masker.items()):
        if clips and masker not in matched:
            continue
        loudest = min(smr for smr, _ in entries)
        chosen = [pe for smr, pe in entries if smr == loudest]
        info = maskers.get(masker, {})
        kind = info.get("class") or re.sub(r"_?\d+$", "", masker)
        src, duration, level = None, None, None
        if masker in matched:
            wav, duration, level = matched[masker]
            (folder / f"{slug(masker)}.wav").write_bytes(wav)
            src = f"libraries/araus/audio/{slug(masker)}.wav"
        url = re.search(r"https?://\S+?(?=\.?$|\s)", info.get("citation", ""))
        sounds.append({
            "arousal": round(clamp(statistics.mean(x[1] for x in chosen)), 4),
            "category": kind,
            "credit": info.get("citation") or None,
            "duration": duration,
            "id": f"araus:{slug(masker)}",
            "label": f"{kind.capitalize()} · {re.sub(r'^[a-z]+_?', '', masker) or masker}",
            "levelDb": level,
            "licence": info.get("license") or None,
            "n": len(chosen),
            "src": src,
            "url": url.group(0) if url else None,
            "valence": round(clamp(statistics.mean(x[0] for x in chosen)), 4),
        })

    missing = len(by_masker) - len(sounds)
    write_library({
        "coordinates": "ISO/TS 12913-3 pleasantness and eventfulness of the urban soundscapes each masker was added to, at the loudest masker level. Describes the masker in context, not on its own."
        + (f" {missing} more rated maskers need maskers.zip (587 MB) to be downloaded." if clips and missing else ""),
        "id": "araus",
        "levelShiftDb": shift,
        "name": "ARAUS maskers",
        "source": "https://researchdata.ntu.edu.sg/dataset.xhtml?persistentId=doi:10.21979/N9/9OTEVX",
    }, sounds)


# ---- custom drop-in ------------------------------------------------------------


def build_custom(folder):
    """Any folder of audio plus a sounds.csv with columns
    file,label,valence,arousal (and optionally scale, licence, credit).
    Valence/arousal may be -1..1 (scale=unit, default), 1-9 (scale=sam9,
    9 = most pleasant / most aroused) or 1-5 (scale=likert5).
    Use this for IADS-E, the AAD, hand-picked BBC or Freesound sounds, or
    your own recordings."""
    source = Path(folder).resolve()
    library_id = slug(source.name)
    print(f"Custom: {library_id}")
    out = audio_folder(library_id)
    sounds = []
    for row in csv.DictReader(open(source / "sounds.csv", encoding="utf-8-sig")):
        scale = (row.get("scale") or "unit").strip()
        convert = {
            "unit": lambda x: x,
            "sam9": lambda x: (x - 5) / 4,
            "likert5": lambda x: (x - 3) / 2,
        }[scale]
        file = row["file"].strip()
        shutil.copy(source / file, out / Path(file).name)
        duration = None
        if file.lower().endswith(".wav"):
            duration = round(wav_seconds((source / file).read_bytes()), 2)
        sounds.append({
            "arousal": round(clamp(convert(float(row["arousal"]))), 4),
            "credit": row.get("credit") or None,
            "duration": duration,
            "id": f"{library_id}:{slug(Path(file).stem)}",
            "label": row.get("label") or Path(file).stem,
            "src": f"libraries/{library_id}/audio/{Path(file).name}",
            "valence": round(clamp(convert(float(row["valence"]))), 4),
        })
    write_library({
        "coordinates": "From sounds.csv in the source folder.",
        "id": library_id,
        "licence": "See the source folder",
        "name": source.name,
        "publishable": False,
        "source": str(source),
    }, sounds)


BUILDERS = {"emo": build_emo, "nessti": build_nessti, "isd": build_isd, "araus": build_araus}

if __name__ == "__main__":
    args = sys.argv[1:] or list(BUILDERS)
    OUT.mkdir(parents=True, exist_ok=True)
    if args[0] == "refresh":
        refresh()
        sys.exit()
    if args[0] == "custom":
        for folder in args[1:]:
            build_custom(folder)
        sys.exit()
    for name in args:
        try:
            BUILDERS[name]()
        except Exception as error:  # keep going: one library failing shouldn't stop the rest
            print(f"  {name} failed: {error}")
