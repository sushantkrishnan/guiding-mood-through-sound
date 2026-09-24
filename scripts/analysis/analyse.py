#!/usr/bin/env python3
"""
Turn study session logs into tables and a summary.

    python3 scripts/analysis/analyse.py <logs folder> [--out <folder>]

Reads every *.json study log in the folder (schema moodist-study/1 or /2)
and writes, to <out> (default: <logs folder>/analysis):

    sessions.csv  one row per participant-session
    probes.csv    one row per check-in answer
    curves.csv    one row per point of each retrospective mood curve
    ratings.csv   one row per sound rating, beside the provisional coordinates
    summary.md    the analysis planned in docs/proposal-sections.md §4.4

The plan it follows: preference and the experiential ratings are primary;
"felt like it was going somewhere" is a manipulation check; change in
self-reported affect is secondary and reported descriptively, because a
pilot this size is not powered to detect it.

Standard library only (Python 3.9+), like scripts/libraries/, so teammates
need nothing installed.
"""

import argparse
import csv
import json
import math
import re
import statistics
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AFFECT_TS = ROOT / "src" / "lib" / "affect.ts"

SCHEMAS = {"moodist-study/1", "moodist-study/2"}
LIKERT = ["pleasantness", "coherence", "monotony", "effectiveness"]
CHECK = "direction"
LABELS = {
    "direct": "Direct target",
    "drift": "Direct + drift",
    "iso": "Guided (iso)",
    "linear": "Linear",
    "unguided": "Unguided",
}
# conditions listed in this order wherever they appear
ORDER = ["iso", "direct", "drift", "unguided", "linear"]

# two-sided 97.5% quantiles of Student's t, df 1..30
T975 = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
]


# ---- statistics -------------------------------------------------------------


def wilson(k, n, z=1.96):
    """Wilson score interval for a proportion."""
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (centre - half, centre + half)


def binomial_two_sided(k, n):
    """Exact two-sided sign test against 50:50."""
    if n == 0:
        return math.nan
    tail = min(k, n - k)
    p = sum(math.comb(n, i) for i in range(tail + 1)) / 2 ** n
    return min(1.0, 2 * p)


def wilcoxon(differences):
    """
    Wilcoxon signed-rank test on paired differences. Zeros are dropped; tied
    absolute values get average ranks. Exact p for n <= 30 (by counting every
    sign assignment over the doubled ranks), normal approximation above.
    Returns (n, W+, p).
    """
    diffs = [d for d in differences if d != 0]
    n = len(diffs)
    if n == 0:
        return (0, math.nan, math.nan)

    ordered = sorted(range(n), key=lambda i: abs(diffs[i]))
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(diffs[ordered[j + 1]]) == abs(diffs[ordered[i]]):
            j += 1
        for m in range(i, j + 1):
            ranks[ordered[m]] = (i + j) / 2 + 1
        i = j + 1

    w_plus = sum(r for r, d in zip(ranks, diffs) if d > 0)

    if n <= 30:
        doubled = [int(round(r * 2)) for r in ranks]
        total = sum(doubled)
        counts = [0] * (total + 1)
        counts[0] = 1
        for r in doubled:
            for s in range(total, r - 1, -1):
                counts[s] += counts[s - r]
        observed = int(round(w_plus * 2))
        mean = total / 2
        extreme = abs(observed - mean)
        hits = sum(c for s, c in enumerate(counts) if abs(s - mean) >= extreme - 1e-9)
        return (n, w_plus, min(1.0, hits / 2 ** n))

    mean = n * (n + 1) / 4
    ties = defaultdict(int)
    for r in ranks:
        ties[r] += 1
    variance = n * (n + 1) * (2 * n + 1) / 24 - sum(t ** 3 - t for t in ties.values()) / 48
    z = (abs(w_plus - mean) - 0.5) / math.sqrt(variance)
    return (n, w_plus, math.erfc(z / math.sqrt(2)))


def mean_ci(values):
    """Mean with a t-based 95% confidence interval."""
    values = [v for v in values if v is not None]
    n = len(values)
    if n == 0:
        return (0, math.nan, math.nan, math.nan)
    m = statistics.fmean(values)
    if n == 1:
        return (1, m, math.nan, math.nan)
    t = T975[n - 2] if n - 1 <= len(T975) else 1.96
    half = t * statistics.stdev(values) / math.sqrt(n)
    return (n, m, m - half, m + half)


def pearson(xs, ys):
    if len(xs) < 3:
        return math.nan
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else math.nan


# ---- reading ----------------------------------------------------------------


def load(folder):
    logs = []
    for path in sorted(Path(folder).glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("schema") in SCHEMAS:
            data["_file"] = path.name
            logs.append(data)
    return logs


def provisional_map():
    """The affect map the logs were made against, read from the source."""
    try:
        text = AFFECT_TS.read_text()
    except OSError:
        return {}
    text = text.split("export const orphanedAffect")[0]
    pattern = r"(?:'([\w-]+)'|([\w-]+)): \{ arousal: (-?[\d.]+), valence: (-?[\d.]+) \}"
    return {
        (m.group(1) or m.group(2)): (float(m.group(4)), float(m.group(3)))
        for m in re.finditer(pattern, text)
    }


def grid(answer):
    """(pleasure, arousal) on the 1..9 grid, or (None, None)."""
    if not answer:
        return (None, None)
    g = answer.get("grid", {})
    return (g.get("pleasure"), g.get("arousal"))


def target_of(log):
    route = log.get("route")
    if route:
        return route["to"]
    return log["measures"].get("target")


def cells(a, b):
    if None in a or None in b:
        return None
    return math.hypot(a[0] - b[0], a[1] - b[1])


def label(condition):
    return LABELS.get(condition, condition)


def fmt(x, dp=2):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    return f"{x:.{dp}f}"


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


# ---- tables -----------------------------------------------------------------


def session_rows(logs):
    rows = []
    for log in logs:
        m, s = log["measures"], log["summary"]
        flags = log.get("flags", {})
        q = m.get("questionnaire") or {}
        pre, post, target = grid(m.get("pre")), grid(m.get("post")), grid(target_of(log))
        before, after = cells(pre, target), cells(post, target)
        preferred = q.get("preferredSession")
        order = log.get("order", [])
        rows.append({
            "participant": log["participantId"],
            "number": log.get("participantNumber"),
            "session": log["session"],
            "position": log["session"],
            "condition": log["condition"],
            "order": "|".join(order),
            "schema": log["schema"],
            "commit": (log.get("build") or {}).get("commit"),
            "map_hash": (log.get("config", {}).get("map") or {}).get("hash"),
            "device": (log.get("setup") or {}).get("device"),
            "started_local": log.get("startedLocal") or log.get("startedAt"),
            "duration_ms": log["config"]["durationMs"],
            "listened_ms": s.get("listenedMs"),
            "completed": s.get("completed"),
            "exited_early_ms": s.get("exitedEarlyMs"),
            "pauses": s.get("pauses"),
            "volume_changes": s.get("volumeChanges"),
            "mixer_changes": s.get("mixerChanges"),
            "target_exposure_ms": s.get("targetExposureMs"),
            "target_source": (log.get("route") or {}).get("toSource", "participant"),
            "close_start_target": flags.get("closeStartTarget"),
            "target_gap": flags.get("targetGap"),
            "hours_since_previous": (
                round(flags["sincePreviousMs"] / 3_600_000, 2)
                if flags.get("sincePreviousMs") is not None
                else None
            ),
            "pre_pleasure": pre[0],
            "pre_arousal": pre[1],
            "target_pleasure": target[0],
            "target_arousal": target[1],
            "post_pleasure": post[0],
            "post_arousal": post[1],
            "change_pleasure": post[0] - pre[0] if None not in (pre[0], post[0]) else None,
            "change_arousal": post[1] - pre[1] if None not in (pre[1], post[1]) else None,
            "cells_to_target_pre": before,
            "cells_to_target_post": after,
            "progress_cells": before - after if None not in (before, after) else None,
            **{item: q.get(item) for item in LIKERT + [CHECK]},
            "wrong_moment": q.get("wrongMoment"),
            "wrong_moment_detail": q.get("wrongMomentDetail", ""),
            "preferred_session": preferred,
            "preferred_condition": (
                "none" if preferred == 0
                else order[preferred - 1] if preferred and preferred <= len(order)
                else None
            ),
            "preference_reason": q.get("preferenceReason", ""),
            "comments": q.get("comments", ""),
            "file": log["_file"],
        })
    return sorted(rows, key=lambda r: (r["participant"], r["session"]))


def probe_rows(logs):
    rows = []
    for log in logs:
        for p in log["measures"].get("probes", []):
            pleasure, arousal = grid(p.get("answer"))
            rows.append({
                "participant": log["participantId"],
                "session": log["session"],
                "condition": log["condition"],
                "index": p["index"],
                "due_ms": p["dueMs"],
                "shown_ms": p.get("shownMs"),
                "answered_ms": p.get("answeredMs"),
                "pleasure": pleasure,
                "arousal": arousal,
            })
    return rows


def curve_rows(logs):
    rows = []
    for log in logs:
        curve = log["measures"].get("curve")
        if not curve:
            continue
        points = len(curve["pleasantness"])
        for i in range(points):
            rows.append({
                "participant": log["participantId"],
                "session": log["session"],
                "condition": log["condition"],
                "point": i,
                "fraction": round(i / (points - 1), 3) if points > 1 else 0,
                "pleasantness": curve["pleasantness"][i],
                "energy": curve["energy"][i],
            })
    return rows


def rating_rows(logs, provisional):
    rows = []
    for log in logs:
        for r in log["measures"].get("ratings", []):
            valence, arousal = r["answer"]["valence"], r["answer"]["arousal"]
            prov = provisional.get(r["id"])
            rows.append({
                "participant": log["participantId"],
                "sound": r["id"],
                "index": r["index"],
                "listened_ms": r["answeredMs"] - r["shownMs"],
                "pleasure": r["answer"]["grid"]["pleasure"],
                "arousal_grid": r["answer"]["grid"]["arousal"],
                "valence": valence,
                "arousal": arousal,
                "provisional_valence": prov[0] if prov else None,
                "provisional_arousal": prov[1] if prov else None,
            })
    return rows


def write_csv(path, rows):
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


# ---- summary ----------------------------------------------------------------


def summarise(sessions, probes, curves, ratings):
    out = []
    say = out.append
    conditions = [c for c in ORDER if any(r["condition"] == c for r in sessions)]
    conditions += sorted({r["condition"] for r in sessions} - set(conditions))
    participants = sorted({r["participant"] for r in sessions})
    by_participant = defaultdict(dict)
    for r in sessions:
        by_participant[r["participant"]][r["condition"]] = r

    say("# Study analysis\n")
    if participants and all(p.startswith("BOT") for p in participants):
        say("> **These logs come from the study bot.** The answers are random; "
            "the numbers below only show that the pipeline works.\n")

    say(f"{len(participants)} participants, {len(sessions)} sessions. "
        "Conditions: " + ", ".join(
            f"{label(c)} ({sum(r['condition'] == c for r in sessions)})" for c in conditions
        ) + ".\n")

    # -- data quality
    say("## Data quality\n")
    issues = []
    early = [r for r in sessions if r["exited_early_ms"] is not None]
    close = [r for r in sessions if r["close_start_target"]]
    sparse = [r for r in sessions if (r["target_gap"] or 0) > 0.4]
    same_day = [r for r in sessions if r["hours_since_previous"] is not None and r["hours_since_previous"] < 12]
    maps = sorted({r["map_hash"] for r in sessions if r["map_hash"]})
    commits = sorted({r["commit"] for r in sessions if r["commit"]})
    incomplete = [p for p in participants if len(by_participant[p]) < len(conditions)]
    if early:
        issues.append(f"{len(early)} session(s) ended early: " + ", ".join(f"{r['participant']} s{r['session']}" for r in early))
    if close:
        issues.append(f"{len(close)} session(s) had start and target too close to separate the conditions: " + ", ".join(f"{r['participant']} s{r['session']}" for r in close))
    if sparse:
        issues.append(f"{len(sparse)} session(s) aimed at a sparse part of the map (target gap > 0.4)")
    if same_day:
        issues.append(f"{len(same_day)} session(s) ran within 12 hours of the participant's previous one")
    if len(maps) > 1:
        issues.append(f"**The affect map changed during the study** ({', '.join(maps)}); compare sessions only within one map")
    if incomplete:
        issues.append(f"{len(incomplete)} participant(s) without every condition: {', '.join(incomplete)} (left out of paired tests)")
    say("\n".join(f"- {i}" for i in issues) if issues else "- No problems flagged.")
    say(f"\nBuilds: {', '.join(commits) or 'unknown'}. Maps: {', '.join(maps) or 'unknown'}.\n")

    # -- manipulation check
    say("## Manipulation check\n")
    say("\"The soundscape felt like it was going somewhere\" (1–7). Guided should score "
        "higher than direct; if it does not, the manipulation did not register.\n")
    rows = []
    for c in conditions:
        values = [r[CHECK] for r in sessions if r["condition"] == c and r[CHECK] is not None]
        rows.append([label(c), len(values), fmt(statistics.median(values) if values else None, 1), fmt(statistics.fmean(values) if values else None)])
    say(table(["Condition", "n", "Median", "Mean"], rows) + "\n")

    # -- primary: preference
    say("## Primary: preference\n")
    finals = [r for r in sessions if r["preferred_condition"] is not None]
    counts = defaultdict(int)
    for r in finals:
        counts[r["preferred_condition"]] += 1
    say(table(["Preferred", "Participants"], [[label(c) if c != "none" else "No preference", counts[c]] for c in conditions + ["none"] if counts[c] or c == "none"]) + "\n")
    if "iso" in conditions:
        for other in [c for c in conditions if c != "iso"]:
            both = [r for r in finals if {"iso", other} <= set(r["order"].split("|")) and r["preferred_condition"] in ("iso", other)]
            k, n = sum(r["preferred_condition"] == "iso" for r in both), len(both)
            if n:
                lo, hi = wilson(k, n)
                say(f"- Guided over {label(other)}: {k} of {n} who stated a preference "
                    f"({fmt(100 * k / n, 0)}%, 95% CI {fmt(100 * lo, 0)}–{fmt(100 * hi, 0)}%), "
                    f"exact sign test p = {fmt(binomial_two_sided(k, n), 3)}.")
        say("\nReport the share and its interval; at pilot size the test only detects a strong preference.\n")

    # -- primary: experiential ratings
    say("## Primary: experiential ratings\n")
    say("1–7 agreement. Paired comparisons use participants who did both conditions "
        "(Wilcoxon signed-rank, exact below n = 30). Monotony is the check on "
        "variety: a guided win that comes with lower monotony may be about change, not direction.\n")
    rows = []
    for item in LIKERT:
        for c in conditions:
            values = [r[item] for r in sessions if r["condition"] == c and r[item] is not None]
            rows.append([item, label(c), len(values), fmt(statistics.median(values) if values else None, 1), fmt(statistics.fmean(values) if values else None)])
    say(table(["Item", "Condition", "n", "Median", "Mean"], rows) + "\n")
    rows = []
    for a, b in combinations(conditions, 2):
        for item in LIKERT + [CHECK]:
            diffs = [p[a][item] - p[b][item] for p in by_participant.values() if a in p and b in p and p[a][item] is not None and p[b][item] is not None]
            if not diffs:
                continue
            n, w, pval = wilcoxon(diffs)
            rows.append([f"{label(a)} − {label(b)}", item, len(diffs), fmt(statistics.median(diffs), 1), fmt(w, 1), fmt(pval, 3)])
    if rows:
        say(table(["Comparison", "Item", "Pairs", "Median diff", "W+", "p"], rows) + "\n")

    # -- secondary: affect
    say("## Secondary: self-reported affect (descriptive)\n")
    say("Change from the pre to the post rating, in grid points (1–9 scale), with 95% "
        "confidence intervals. \"Progress\" is how many cells closer to their target "
        "participants ended than they started. Not powered for between-condition tests.\n")
    rows = []
    for c in conditions:
        group = [r for r in sessions if r["condition"] == c]
        for name, key in [("Pleasantness change", "change_pleasure"), ("Arousal change", "change_arousal"), ("Progress to target (cells)", "progress_cells")]:
            n, m, lo, hi = mean_ci([r[key] for r in group])
            rows.append([label(c), name, n, fmt(m), f"{fmt(lo)} to {fmt(hi)}"])
    say(table(["Condition", "Measure", "n", "Mean", "95% CI"], rows) + "\n")

    if probes:
        say("Check-in answers by condition and moment (mean pleasantness, arousal):\n")
        rows = []
        for c in conditions:
            for index in sorted({p["index"] for p in probes if p["condition"] == c}):
                group = [p for p in probes if p["condition"] == c and p["index"] == index and p["pleasure"] is not None]
                if group:
                    rows.append([label(c), index + 1, len(group), fmt(statistics.fmean(p["pleasure"] for p in group)), fmt(statistics.fmean(p["arousal"] for p in group))])
        say(table(["Condition", "Check-in", "n", "Pleasantness", "Arousal"], rows) + "\n")

    if curves:
        say("Mean retrospective mood curve (1–9) by condition, start → end:\n")
        rows = []
        for c in conditions:
            for measure in ["pleasantness", "energy"]:
                points = sorted({p["point"] for p in curves if p["condition"] == c})
                if points:
                    rows.append([label(c), measure, " ".join(fmt(statistics.fmean(p[measure] for p in curves if p["condition"] == c and p["point"] == i), 1) for i in points)])
        say(table(["Condition", "Curve", "Points"], rows) + "\n")

    # -- order effects
    say("## Order check\n")
    say("Mean of each item by session position. A large difference between positions "
        "that does not follow condition suggests carry-over or fatigue.\n")
    positions = sorted({r["position"] for r in sessions})
    rows = []
    for item in LIKERT + [CHECK]:
        cells_ = []
        for pos in positions:
            values = [r[item] for r in sessions if r["position"] == pos and r[item] is not None]
            cells_.append(fmt(statistics.fmean(values) if values else None))
        rows.append([item] + cells_)
    say(table(["Item"] + [f"Session {p}" for p in positions], rows) + "\n")

    # -- behaviour
    say("## Behaviour\n")
    rows = []
    for c in conditions:
        group = [r for r in sessions if r["condition"] == c]
        rows.append([
            label(c), len(group),
            sum(r["exited_early_ms"] is not None for r in group),
            fmt(statistics.fmean(r["pauses"] or 0 for r in group), 1),
            fmt(statistics.fmean(r["volume_changes"] or 0 for r in group), 1),
            fmt(statistics.fmean(r["mixer_changes"] or 0 for r in group), 1),
            fmt(statistics.fmean((r["target_exposure_ms"] or 0) / 60_000 for r in group), 1),
        ])
    say(table(["Condition", "Sessions", "Ended early", "Pauses", "Volume changes", "Mixer changes", "Minutes at target"], rows) + "\n")

    # -- ratings
    if ratings:
        say("## Sound ratings vs the provisional map\n")
        say("Listener ratings (engine scale −1..+1) of the sounds participants heard, "
            "against the author-assigned coordinates in src/lib/affect.ts. Low agreement "
            "means the map, not the transition, is the first thing to fix.\n")
        per_sound = defaultdict(list)
        for r in ratings:
            per_sound[r["sound"]].append(r)
        rows, xs_v, ys_v, xs_a, ys_a = [], [], [], [], []
        for sound, group in sorted(per_sound.items(), key=lambda kv: -len(kv[1])):
            v = statistics.fmean(r["valence"] for r in group)
            a = statistics.fmean(r["arousal"] for r in group)
            pv, pa = group[0]["provisional_valence"], group[0]["provisional_arousal"]
            if pv is not None:
                xs_v.append(pv); ys_v.append(v); xs_a.append(pa); ys_a.append(a)
            rows.append([sound, len(group), fmt(v), fmt(a), fmt(pv), fmt(pa), fmt(math.hypot(v - pv, a - pa) if pv is not None else None)])
        say(table(["Sound", "Ratings", "Valence", "Arousal", "Map valence", "Map arousal", "Distance"], rows) + "\n")
        say(f"Agreement across sounds: valence r = {fmt(pearson(xs_v, ys_v))}, "
            f"arousal r = {fmt(pearson(xs_a, ys_a))} ({len(xs_v)} sounds).\n")

    # -- qualitative
    reports = [r for r in sessions if r["wrong_moment"]]
    notes = [r for r in sessions if r["comments"] or r["preference_reason"]]
    if reports or notes:
        say("## What participants wrote\n")
        for r in reports:
            say(f"- **Wrong moment**, {r['participant']} s{r['session']} ({label(r['condition'])}): {r['wrong_moment_detail'] or '(no detail)'}")
        for r in notes:
            if r["preference_reason"]:
                say(f"- **Preference**, {r['participant']}: {r['preference_reason']}")
            if r["comments"]:
                say(f"- **Comment**, {r['participant']} s{r['session']} ({label(r['condition'])}): {r['comments']}")
        say("")

    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("logs", help="folder of downloaded session logs")
    parser.add_argument("--out", help="output folder (default: <logs>/analysis)")
    args = parser.parse_args()

    logs = load(args.logs)
    if not logs:
        sys.exit(f"No study logs found in {args.logs}")

    out = Path(args.out or Path(args.logs) / "analysis")
    out.mkdir(parents=True, exist_ok=True)

    sessions = session_rows(logs)
    probes = probe_rows(logs)
    curves = curve_rows(logs)
    ratings = rating_rows(logs, provisional_map())

    write_csv(out / "sessions.csv", sessions)
    write_csv(out / "probes.csv", probes)
    write_csv(out / "curves.csv", curves)
    write_csv(out / "ratings.csv", ratings)
    (out / "summary.md").write_text(summarise(sessions, probes, curves, ratings))

    print(f"{len(logs)} logs → {out}/ (sessions.csv, probes.csv, curves.csv, ratings.csv, summary.md)")


if __name__ == "__main__":
    main()
