# Study harness: how to run the pilot

Written 25 Sep 2026, alongside the `pilot-prep` branch; updated 6 Oct 2026 to match the study protocol (`Protocol_Guiding_Mood_Through_Sound.docx`), which is the authority on procedure and analysis. This is the practical guide: what the harness does, how to run a session, what gets logged, and how to analyse it. The reasoning behind the design is in `proposal-sections.md`. Where the two disagree on engine details, this file is newer.

## What changed and why, in one table

| Change | Why |
|---|---|
| Sounds fade in and out of the mix from zero | The old cut-off let a sound enter at ~0.3–0.35 gain: 21 abrupt entries on a tense→calm route, none in direct. That biased "did anything sound wrong?" against guided. |
| The mix is normalised to constant power | Before, crowded parts of the map played up to 7 dB louder. Loudness moves arousal, the thing being measured. |
| Scene coherence | Sounds from categories that play no part at either end of the route are down-weighted, so the way from traffic to rain skips the washing machine. |
| iso matches energy, not unpleasantness | A tense participant used to hear 2.5 min of construction site and siren, then ~3 min of fluorescent hum. Now the iso start never goes below neutral valence, and the hold is 10%, not 25%. |
| Guided routes end with 20% at the target | Every condition now finishes on the target, so the post rating compares like with like. |
| New `drift` control | Stays at the target but circles it, calibrated so the mix changes as much in total as iso would (within 3% on every route tested; capped at 8 loops, so routes into the sparse unpleasant-and-sleepy corner fall short, which the log records). Separates "it went somewhere" from "it changed". |
| The grid is fitted to the map | The grid runs to ±1, the sounds don't (arousal stops at −0.6). Badly rendered grid cells drop from 28 to 10 of 81. |

## Running a session

**Once, before recruiting:**
1. `pnpm build && pnpm preview` (or the Pages build). Open `/?study`.
2. Run the bot to check the whole pipeline (below).
3. Pilot with two or three teammates at full length.

**Each session:**
1. Same room, same headphones, same device. Note the headphones in *Headphones and device*.
2. Set the participant ID, number and session. The counterbalanced order is shown. Recruit in the multiple it states.
3. Play the calibration sound. Set the **device** volume so it is comfortable, then leave the device volume alone for the whole study.
4. Start the session and hand over the device. The participant sees only their screens, never the condition.
5. After the session the log downloads (`moodist-P01-s1.json`) and a backup stays in the browser (IndexedDB). Copy the download somewhere safe straight away.
6. Both sessions run in one visit. After the Session 1 questionnaire and the 5-minute rest, press **Start session 2 for P01** on the thank-you screen: it keeps the setup and moves to the next session, so there is no second setup. (Back to setup still works; it shows how long ago the participant's previous session ended, so the session number can be checked.)

## Setup options (defaults in bold)

The defaults are the protocol's settings (section 3.1), so a fresh browser needs only the participant ID and number. A browser remembers the last setup it ran, so check the values on a machine used for testing.

| Option | Choices | Notes |
|---|---|---|
| Conditions | **Guided**, **Direct target**, Direct + drift, Unguided | Guided and Direct target are the protocol's guided and fixed conditions. Odd participant numbers hear guided first, even numbers fixed first. Linear is not offered to participants; it stays in the visualiser. |
| Listening time | **5 minutes** | |
| Target | same as their first session, participant chooses, **fixed: pleasantness 7, arousal 3** | Fixed is the protocol: every session heads for the same calm cell. Participants are still asked "How would you like to feel?"; the answer is logged (`measures.target`) but does not change the route. "Same as first" needs session 1 in the same browser. |
| Flag start/target closer than | **2 cells** | Closer than this and every condition sounds nearly the same. The session still runs; the log flags it, and the analysis repeats H1 without those participants. |
| Fit the grid to the sound map | **on** | See the table above. |
| Check-ins | halfway and on arrival, **every 2 minutes**, none | Every 2 minutes gives check-ins at 2:00 and 4:00 in a 5-minute session, the same times in every condition. A check-in left unanswered closes itself after 45 s of listening and is logged as missed (`probe-missed`); one that falls due while another is open is skipped. |
| Chime | **on** | A soft two-note chime when a check-in appears, for eyes-closed listening. |
| Mood curve | **off** | After the post rating, the participant draws how pleasant and how energised they felt over the session (after Kujala et al.'s UX Curve). Off in the protocol: the check-ins already give the trajectory. |
| Rating block | **on**, **12 sounds**, **10 s** | Final session only. Plays the sounds this participant heard most, one at a time and unnamed, and asks how each makes them feel: the only data that tests the provisional sound map. Adds about 3 minutes. |
| Starting volume | **80%** | Applied when listening starts, for every condition. |

## What the participant sees

Welcome → how do you feel now → how would you like to feel (with a faint ring showing "now"; shown read-only instead when the target is "same as first session") → listening ("Just listen", no countdown, eyes may close) with check-ins → how do you feel now → (mood curve, if on) → questionnaire → (final session) rating block → thank you.

Questionnaire items, in order: pleasant, one scene, **monotonous** (new), helped me move towards how I wanted to feel, **felt like it was going somewhere** (last: it is the manipulation check, not an outcome). Plus "did any moment sound wrong", and in the final session the preference question.

In the unguided condition the page shows only the mixer. Donation prompts, marketing sections and favourites are hidden in study mode.

## What a log contains (`moodist-study/2`)

- `setup`: every option above, as run.
- `route`: the grid answers it was built from (`from`, `to`, `toSource`) and the fitted engine points actually played (`start`, `target`).
- `measures`: `pre`, `target` (the answer to "How would you like to feel?", recorded even when the target is fixed; null if not asked), `probes` (each with when it was due, shown and answered; unanswered ones have a null answer), `post`, `curve`, `questionnaire`, `ratings`.
- `flags`: `closeStartTarget`, `targetGap` (distance between the target and the mix played there; above 0.4 means a sparse part of the map), `sincePreviousMs`.
- `config`: engine settings, map fingerprint (`map.hash`), check-in times, trace rate.
- `build`: git commit and whether the build had uncommitted changes.
- `trace`: 2 rows per second. Guided sessions replay exactly from `route` (the visualiser does this), so more would only cost space. Unguided sessions also log every mixer change as an event.
- `summary`: completion, early exit, pauses, volume and mixer changes, time at target.

A 10-minute log is about 250 KB (was 1.5 MB). The visualiser (`/?visualise`) opens both v1 and v2 logs.

**If the map changes** (new coordinates from ratings), `config.map.hash` changes. Do not pool sessions across hashes; the analysis flags it.

## Analysis

The study's analysis is the protocol's (section 5), in `scripts/analysis/protocol_analysis.py`:

```bash
pip install numpy scipy matplotlib     # once
pnpm study:protocol path/to/logs [--exclude P03,P07]
```

`--exclude` drops participants for reasons the logs can't show: withdrawal, or a dropout or app error the note-taker recorded. The script applies the other exclusion rules itself (both sessions, at least 80% listened, pre and post ratings, no sounds that failed to load) and writes `protocol/` next to the logs: `participants.csv`, `checkins.csv`, `results.md` and `trajectory.png`. The primary outcome is the change in calmness (valence − arousal on the −4..+4 grid), guided against fixed, by paired t-test, or Wilcoxon signed-rank when the paired differences are not normal. It also runs the baseline, order, valence/arousal, manipulation-check, monotony, secondary-item (Holm-corrected) and preference analyses, and repeats H1 without close start/target participants and in those who wanted to feel calm.

A second, older summary is still available for data quality and the pilot's descriptive measures:

```bash
pnpm study:analyse path/to/logs        # python3 scripts/analysis/analyse.py
```

It writes `analysis/` next to the logs: `sessions.csv`, `probes.csv`, `curves.csv`, `ratings.csv` (listener ratings of sounds, against the provisional map) and `summary.md`, using only the standard library. Its summary follows the earlier plan in proposal-sections §4.4, where preference was the main outcome; for the study, report the protocol analysis.

## Testing the pipeline without people

```bash
pnpm build && pnpm preview                                   # terminal 1
BASE_URL=http://localhost:4321/ pnpm study:bot               # terminal 2
pnpm study:protocol .cache/bot-logs
```

The bot drives real sessions in headless Chrome with random answers (`PARTICIPANTS`, `MINUTES` (min 0.5), `CONDITIONS`, `OUT`, `SEED`), moving to each next session with the thank-you screen's button, as the protocol does. It uses installed Google Chrome, or `CHROME_PATH=/path/to/chrome`. Four participants × two sessions take a few minutes. Both analyses mark bot data as such. With several bots at once, some sounds can miss the load timeout and those participants are excluded, which also exercises the exclusion rules.

`pnpm test` runs the unit tests (~7 s). The one to keep green is *study routes have no abrupt entries*.

## Still the group's call

- **Ethics.** The iso start is now neutral-valence and energetic rather than unpleasant, but any condition can still play aversive sounds (e.g. a direct session towards a tense target). Say so in the application.
- **Coordinates.** `src/lib/affect.ts` is still author-assigned. The rating block collects listener ratings for exactly the sounds used. Replace the map between pilot and main study, and treat the two as separate datasets.
- **Scene labels.** Coherence uses Moodist's categories, which are coarse ("places" covers church, office and airport). A tense→calm iso route currently runs through places (crowded bar, office, laundry room) into rain. Hand-made scene labels can be passed as `categories` if the group wants finer control.
- **Conditions and n.** Two arms at n ≈ 20 beats four at n ≈ 16. Add drift or unguided only if recruitment allows the multiple the setup screen states.
- **Stressor.** "Same as first" plus the 2-cell flag reduces, but does not remove, sessions where the participant arrives already calm. A short stressor before session start (proposal §4.4) would.
