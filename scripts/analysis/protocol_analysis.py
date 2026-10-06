#!/usr/bin/env python3
"""
The analysis in the study protocol (docs/Protocol_Guiding_Mood_Through_Sound.docx,
section 5): guided against fixed, within subjects.

    python3 scripts/analysis/protocol_analysis.py <logs folder> [--out <folder>]
        [--exclude P03,P07]

Reads the session logs the study harness downloads (moodist-P01-s1.json, ...).
--exclude drops participants for reasons the logs can't show: withdrawal, or
an audio dropout or app error the note-taker recorded (section 2.6).
Writes to <out> (default <logs folder>/protocol):

    participants.csv  one row per participant per condition
    checkins.csv      one row per mood rating: pre, each check-in, post
    results.md        every analysis in section 5.3, in order
    trajectory.png    mean calmness over each session, by condition

Needs numpy, scipy and matplotlib: pip install numpy scipy matplotlib
"""

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np
from scipy import stats

CONDITIONS = {"iso": "guided", "direct": "fixed"}
SCALES = ["direction", "pleasantness", "coherence", "monotony", "effectiveness"]
MIN_LISTENED = 0.8  # share of the session a participant must hear (section 2.6)


# ---- scoring (section 2.1) ---------------------------------------------------


def mood(answer):
    """Affect Grid answer -> (valence, arousal, calmness), each grid axis -4..+4."""
    if not answer:
        return None
    valence = answer["grid"]["pleasure"] - 5
    arousal = answer["grid"]["arousal"] - 5
    return valence, arousal, valence - arousal


# ---- reading the logs --------------------------------------------------------


def load(folder):
    """{participant: {condition: log}} for guided and fixed sessions."""
    people = {}
    for path in sorted(Path(folder).glob("*.json")):
        try:
            log = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not str(log.get("schema", "")).startswith("moodist-study/"):
            continue
        condition = CONDITIONS.get(log["condition"])
        if condition:
            people.setdefault(log["participantId"], {})[condition] = log
    return people


def exclusion(sessions):
    """Why a participant is excluded (section 2.6), or None."""
    if set(sessions) != set(CONDITIONS.values()):
        return "did not complete both sessions"
    for condition, log in sessions.items():
        if log["summary"]["listenedMs"] < MIN_LISTENED * log["config"]["durationMs"]:
            return f"listened to under 80% of the {condition} session"
        if not (log["measures"]["pre"] and log["measures"]["post"]):
            return f"missing a pre or post rating in the {condition} session"
        if log["summary"]["missingSounds"]:
            return f"sounds failed to load in the {condition} session"
    return None


def rows(people, excluded):
    """participants.csv rows: one per participant per condition."""
    out = []
    for pid, sessions in sorted(people.items()):
        if pid in excluded:
            continue
        guided_first = sessions["guided"]["order"][0] == "iso"
        for condition, log in sessions.items():
            m = log["measures"]
            q = m["questionnaire"] or {}
            pre, post, wish = mood(m["pre"]), mood(m["post"]), mood(m["target"])
            out.append({
                "pid": pid,
                "order": "guided_first" if guided_first else "fixed_first",
                "condition": condition,
                "session": log["session"],
                "pre_valence": pre[0], "pre_arousal": pre[1], "pre_calm": pre[2],
                "post_valence": post[0], "post_arousal": post[1], "post_calm": post[2],
                "calm_change": post[2] - pre[2],
                "valence_change": post[0] - pre[0],
                "arousal_change": post[1] - pre[1],
                # wanted the calm corner: pleasant and low energy
                "wanted_calm": bool(wish and wish[0] > 0 and wish[1] < 0),
                "close_start_target": log["flags"]["closeStartTarget"],
                "listened_s": round(log["summary"]["listenedMs"] / 1000),
                "wrong_moment": q.get("wrongMoment"),
                **{scale: q.get(scale) for scale in SCALES},
            })
    return out


def checkins(people, excluded):
    """checkins.csv rows: pre at minute 0, each check-in, post at the end."""
    out = []
    for pid, sessions in sorted(people.items()):
        if pid in excluded:
            continue
        for condition, log in sessions.items():
            m = log["measures"]
            points = [(0, m["pre"])]
            points += [(p["dueMs"] / 60000, p["answer"]) for p in m["probes"]]
            points += [(log["config"]["durationMs"] / 60000, m["post"])]
            for minute, answer in points:
                score = mood(answer)
                out.append({"pid": pid, "condition": condition, "minute": minute,
                            "calm": score[2] if score else None})
    return out


# ---- statistics ----------------------------------------------------------------


def fp(p):
    return "p < .001" if p < 0.001 else f"p = {p:.3f}"


def paired(table, column):
    """(guided, fixed) arrays of one column, paired by participant."""
    by = {(r["pid"], r["condition"]): r[column] for r in table}
    pids = sorted({r["pid"] for r in table})
    pairs = [(by[(p, "guided")], by[(p, "fixed")]) for p in pids
             if by.get((p, "guided")) is not None and by.get((p, "fixed")) is not None]
    return np.array([g for g, _ in pairs], float), np.array([f for _, f in pairs], float)


def t_paired(guided, fixed):
    diff = guided - fixed
    n = len(diff)
    if n < 2 or np.std(diff, ddof=1) == 0:
        return f"n = {n}: too few, or no variation, to test"
    t, p = stats.ttest_rel(guided, fixed)
    half = stats.t.ppf(0.975, n - 1) * np.std(diff, ddof=1) / math.sqrt(n)
    dz = np.mean(diff) / np.std(diff, ddof=1)
    return (f"paired t({n - 1}) = {t:.2f}, {fp(p)}; mean difference "
            f"{np.mean(diff):+.2f} [95% CI {np.mean(diff) - half:+.2f}, "
            f"{np.mean(diff) + half:+.2f}], Cohen's dz = {dz:.2f}")


def wilcoxon(guided, fixed):
    """(text, p), with p None when there is nothing to test."""
    n = len(guided)
    if n < 2 or np.all(guided == fixed):
        return f"n = {n}: too few, or no differences, to test", None
    res = stats.wilcoxon(guided, fixed)
    r = stats.norm.isf(res.pvalue / 2) / math.sqrt(n)
    return f"Wilcoxon W = {res.statistic:.1f}, {fp(res.pvalue)}, r = {r:.2f}, n = {n}", res.pvalue


def h1(table):
    """Change in calmness, guided vs fixed: t-test, or Wilcoxon if not normal."""
    guided, fixed = paired(table, "calm_change")
    diff = guided - fixed
    if len(diff) >= 3 and np.std(diff) > 0:
        normal_p = stats.shapiro(diff).pvalue
        test = f"Shapiro-Wilk on the paired differences {fp(normal_p)}, so: "
        if normal_p < 0.05:
            return test + wilcoxon(guided, fixed)[0]
        return test + t_paired(guided, fixed)
    return t_paired(guided, fixed)


def holm(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [0.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, (len(pvalues) - rank) * pvalues[i])
        adjusted[i] = min(1.0, running)
    return adjusted


def sample_size(dz=0.5, alpha=0.05, power=0.8):
    """Participants a two-sided paired t-test needs (section 5.1)."""
    n = 2
    while True:
        df, crit = n - 1, stats.t.ppf(1 - alpha / 2, n - 1)
        ncp = dz * math.sqrt(n)
        if stats.nct.sf(crit, df, ncp) + stats.nct.cdf(-crit, df, ncp) >= power:
            return n
        n += 1


# ---- report ------------------------------------------------------------------------


def write_csv(path, table):
    if table:
        with path.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(table[0]))
            writer.writeheader()
            writer.writerows(table)


def plot(points, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(6, 4))
    for condition in CONDITIONS.values():
        minutes = sorted({p["minute"] for p in points if p["condition"] == condition})
        means, errors = [], []
        for minute in minutes:
            calm = [p["calm"] for p in points if p["condition"] == condition
                    and p["minute"] == minute and p["calm"] is not None]
            means.append(np.mean(calm) if calm else np.nan)
            errors.append(stats.sem(calm) if len(calm) > 1 else 0)
        ax.errorbar(minutes, means, yerr=errors, marker="o", capsize=3, label=condition)
    ax.set_xlabel("Minute of session")
    ax.set_ylabel("Mean calmness (valence - arousal)")
    ax.legend(title="Condition")
    fig.tight_layout()
    fig.savefig(path, dpi=150)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folder")
    parser.add_argument("--out")
    parser.add_argument("--exclude", default="", help="participant IDs, comma-separated")
    args = parser.parse_args()

    out = Path(args.out or Path(args.folder) / "protocol")
    out.mkdir(parents=True, exist_ok=True)
    people = load(args.folder)
    manual = {p.strip() for p in args.exclude.split(",") if p.strip()}

    reasons = {pid: "excluded by the researchers (--exclude)" for pid in manual & set(people)}
    for pid, sessions in people.items():
        reasons.setdefault(pid, exclusion(sessions))
    excluded = {pid for pid, why in reasons.items() if why}

    table = rows(people, excluded)
    points = checkins(people, excluded)
    write_csv(out / "participants.csv", table)
    write_csv(out / "checkins.csv", points)

    lines = []
    say = lines.append
    analysed = sorted({r["pid"] for r in table})

    say("# Guiding Mood Through Sound: protocol analysis\n")
    if any(pid.startswith("BOT") for pid in people):
        say("**Synthetic data from the study bot: these numbers mean nothing.**\n")
    say(f"Sample size for dz = 0.5, alpha = .05 two-sided, 80% power: {sample_size()}.\n")

    say("## Sample (sections 2.6, 5.2)\n")
    say(f"Participants found: {len(people)}; excluded: {len(excluded)}; analysed: {len(analysed)}.")
    for pid in sorted(excluded):
        say(f"- {pid}: {reasons[pid]}")
    orders = [r["order"] for r in table if r["condition"] == "guided"]
    say(f"\nOrder: {orders.count('guided_first')} guided first, "
        f"{orders.count('fixed_first')} fixed first.\n")
    if not analysed:
        print("\n".join(lines))
        return

    say("## Calmness by condition\n")
    say("| Condition | Pre | Post | Change |\n|---|---|---|---|")
    for condition in CONDITIONS.values():
        cols = [np.array([r[c] for r in table if r["condition"] == condition], float)
                for c in ("pre_calm", "post_calm", "calm_change")]
        say(f"| {condition} | " + " | ".join(
            f"{np.mean(c):+.2f} (SD {np.std(c, ddof=1) if len(c) > 1 else 0:.2f})"
            for c in cols) + " |")

    say("\n## Analyses (section 5.3)\n")
    say(f"- **H1, change in calmness, guided vs fixed:** {h1(table)}")
    say(f"- **Rest period, pre-session calmness:** {t_paired(*paired(table, 'pre_calm'))}")

    change = {(r["pid"], r["condition"]): r["calm_change"] for r in table}
    order_of = {r["pid"]: r["order"] for r in table}
    by_order = [[change[(pid, "guided")] - change[(pid, "fixed")]
                 for pid in analysed if order_of[pid] == order]
                for order in ("guided_first", "fixed_first")]
    if all(len(group) >= 2 for group in by_order):
        t, p = stats.ttest_ind(*by_order, equal_var=False)
        say(f"- **Order, guided-minus-fixed difference by order group:** Welch t = {t:.2f}, {fp(p)}")
    else:
        say("- **Order:** too few participants in an order group to test")

    say(f"- **Change in valence:** {t_paired(*paired(table, 'valence_change'))}")
    say(f"- **Change in arousal:** {t_paired(*paired(table, 'arousal_change'))}")
    say(f"- **Manipulation check, \"going somewhere\":** {wilcoxon(*paired(table, 'direction'))[0]}")
    say(f"- **Monotony (confound check):** {wilcoxon(*paired(table, 'monotony'))[0]}")

    secondary = ["coherence", "pleasantness", "effectiveness"]
    results = [wilcoxon(*paired(table, scale)) for scale in secondary]
    tested = [i for i, (_, p) in enumerate(results) if p is not None]
    adjusted = dict(zip(tested, holm([results[i][1] for i in tested])))
    for i, scale in enumerate(secondary):
        holm_p = f", Holm-adjusted {fp(adjusted[i])}" if i in adjusted else ""
        say(f"- **{scale.capitalize()}:** {results[i][0]}{holm_p}")

    picks = {"guided": 0, "fixed": 0, "none": 0}
    for pid in analysed:
        final = max(people[pid].values(), key=lambda log: log["session"])
        choice = (final["measures"]["questionnaire"] or {}).get("preferredSession")
        if choice == 0:
            picks["none"] += 1
        elif choice:
            first = final["order"][choice - 1]
            picks[CONDITIONS[first]] += 1
    stated = picks["guided"] + picks["fixed"]
    pref = (f"exact binomial {fp(stats.binomtest(picks['guided'], stated).pvalue)}"
            if stated else "no stated preferences")
    say(f"- **Preference:** guided {picks['guided']}, fixed {picks['fixed']}, "
        f"no preference {picks['none']}; {pref}")

    say("\n## Sensitivity (section 5.3)\n")
    close = {r["pid"] for r in table if r["close_start_target"]}
    calm = {pid for pid in analysed
            if all(r["wanted_calm"] for r in table if r["pid"] == pid)}
    say(f"- **H1 without the {len(close)} participants whose start was close to the target:** "
        f"{h1([r for r in table if r['pid'] not in close])}")
    say(f"- **H1 in the {len(calm)} participants who wanted to feel calm in both sessions:** "
        f"{h1([r for r in table if r['pid'] in calm])}")

    say("\n## Descriptive\n")
    for condition in CONDITIONS.values():
        wrong = sum(1 for r in table if r["condition"] == condition and r["wrong_moment"])
        say(f"- {condition}: {wrong} participant(s) said a moment sounded wrong")
    say("- Mood over each session: trajectory.png (means with standard errors)")

    plot(points, out / "trajectory.png")
    (out / "results.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nWritten to {out}/")


if __name__ == "__main__":
    main()
