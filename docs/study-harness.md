# Study harness: how to run the pilot

Written 25 Sep 2026, alongside the `pilot-prep` branch. This is the practical guide: what the harness does, how to run a session, what gets logged, and how to analyse it. The reasoning behind the design is in `proposal-sections.md`. Where the two disagree on engine details, this file is newer.

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
6. Run each participant's sessions on **separate days**. Setup warns if the previous session ended less than 12 hours ago.

## Setup options (defaults in bold)

| Option | Choices | Notes |
|---|---|---|
| Conditions | **Guided**, **Direct target**, Direct + drift, Unguided | Linear is not offered to participants any more; it stays in the visualiser. |
| Target | **Same as their first session**, participant chooses, fixed | "Same as first" makes every session of a participant travel to the same place. It needs session 1 in the same browser; otherwise use Fixed and type the target in. Use Fixed with e.g. pleasantness 7, arousal 3 to test calming down only. |
| Flag start/target closer than | **2 cells** | Closer than this and every condition sounds nearly the same. The session still runs; the log and summary flag it. |
| Fit the grid to the sound map | **on** | See the table above. |
| Check-ins | **halfway and on arrival**, every N minutes, none | Halfway through the movement and on arrival: 45% and 80% of the session, so 4:30 and 8:00 in a 10-minute session. The same times apply to every condition. |
| Chime | **on** | A soft two-note chime when a check-in appears, for eyes-closed listening. |
| Mood curve | **on** | After the post rating, the participant draws how pleasant and how energised they felt over the session (after Kujala et al.'s UX Curve). Works by drag or keyboard. |
| Rating block | **on**, **20 sounds**, **10 s** | Final session only. Plays the sounds this participant heard most, one at a time and unnamed, and asks how each makes them feel. Adds about 5 minutes. |
| Starting volume | **80%** | Applied when listening starts, for every condition. |

## What the participant sees

Welcome → how do you feel now → the target (chosen, with a faint ring showing "now", or shown read-only if it was set for them) → listening ("Just listen", no countdown, eyes may close) with check-ins → how do you feel now → mood curve → questionnaire → (final session) rating block → thank you.

Questionnaire items, in order: pleasant, one scene, **monotonous** (new), helped me move towards how I wanted to feel, **felt like it was going somewhere** (last: it is the manipulation check, not an outcome). Plus "did any moment sound wrong", and in the final session the preference question.

In the unguided condition the page shows only the mixer. Donation prompts, marketing sections and favourites are hidden in study mode.

## What a log contains (`moodist-study/2`)

- `setup`: every option above, as run.
- `route`: the grid answers it was built from (`from`, `to`, `toSource`) and the fitted engine points actually played (`start`, `target`).
- `measures`: `pre`, `target` (the participant's own answer, or null if it was set for them), `probes`, `post`, `curve`, `questionnaire`, `ratings`.
- `flags`: `closeStartTarget`, `targetGap` (distance between the target and the mix played there; above 0.4 means a sparse part of the map), `sincePreviousMs`.
- `config`: engine settings, map fingerprint (`map.hash`), check-in times, trace rate.
- `build`: git commit and whether the build had uncommitted changes.
- `trace`: 2 rows per second. Guided sessions replay exactly from `route` (the visualiser does this), so more would only cost space. Unguided sessions also log every mixer change as an event.
- `summary`: completion, early exit, pauses, volume and mixer changes, time at target.

A 10-minute log is about 250 KB (was 1.5 MB). The visualiser (`/?visualise`) opens both v1 and v2 logs.

**If the map changes** (new coordinates from ratings), `config.map.hash` changes. Do not pool sessions across hashes; the analysis flags it.

## Analysis

```bash
pnpm study:analyse path/to/logs        # python3 scripts/analysis/analyse.py
```

Writes `analysis/` next to the logs: `sessions.csv`, `probes.csv`, `curves.csv`, `ratings.csv` and `summary.md`. Standard-library Python, nothing to install. The summary follows the plan in proposal-sections §4.4:

1. **Data quality**: early exits, flagged sessions, same-day sessions, map or build changes, incomplete participants.
2. **Manipulation check**: "going somewhere" by condition.
3. **Primary**: preference as a share with a Wilson 95% CI and an exact sign test; paired Wilcoxon signed-rank on pleasantness, coherence, monotony and effectiveness.
4. **Secondary, descriptive**: pre→post change and progress towards the target, with t intervals; check-ins; mean mood curves.
5. **Order check**, **behaviour**, **listener ratings against the provisional map**, and what participants wrote.

On power: with an exact sign test, n = 16 and a true 75% preference for guided gives 40% power, n = 20 gives 62%, and ~30 are needed for 80%. Report the share and its interval.

## Testing the pipeline without people

```bash
pnpm build && pnpm preview                                   # terminal 1
BASE_URL=http://localhost:4321/ pnpm study:bot               # terminal 2
pnpm study:analyse .cache/bot-logs
```

The bot drives real sessions in headless Chrome with random answers (`PARTICIPANTS`, `MINUTES` (min 0.5), `CONDITIONS`, `OUT`, `SEED`). It uses installed Google Chrome, or `CHROME_PATH=/path/to/chrome`. Four participants × two sessions take about two minutes. The summary marks bot data as such.

`pnpm test` runs the unit tests (~7 s). The one to keep green is *study routes have no abrupt entries*.

## Still the group's call

- **Ethics.** The iso start is now neutral-valence and energetic rather than unpleasant, but any condition can still play aversive sounds (e.g. a direct session towards a tense target). Say so in the application.
- **Coordinates.** `src/lib/affect.ts` is still author-assigned. The rating block collects listener ratings for exactly the sounds used. Replace the map between pilot and main study, and treat the two as separate datasets.
- **Scene labels.** Coherence uses Moodist's categories, which are coarse ("places" covers church, office and airport). A tense→calm iso route currently runs through places (crowded bar, office, laundry room) into rain. Hand-made scene labels can be passed as `categories` if the group wants finer control.
- **Conditions and n.** Two arms at n ≈ 20 beats four at n ≈ 16. Add drift or unguided only if recruitment allows the multiple the setup screen states.
- **Stressor.** "Same as first" plus the 2-cell flag reduces, but does not remove, sessions where the participant arrives already calm. A short stressor before session start (proposal §4.4) would.
