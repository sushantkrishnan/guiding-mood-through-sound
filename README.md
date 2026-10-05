# Guiding mood through sound

A fork of [Moodist](https://github.com/remvze/moodist), the open-source ambient sound mixer, built for an HCI study. It adds a soundscape that gradually guides a listener from their reported mood toward a chosen mood, rather than playing only the destination. It also includes tools to study whether this gradual transition is experienced differently from arriving at the destination directly.

**Try it:** <https://sushantkrishnan.github.io/moodist-study/>. The [study harness](https://sushantkrishnan.github.io/moodist-study/?study) and the [route visualiser](https://sushantkrishnan.github.io/moodist-study/?visualise) are linked from the main page.

## Team Members

- Gian ([@jee-yann](https://github.com/jee-yann)) - gian.alexavier@gmail.com
- Hayden ([@hsim385](https://github.com/hsim385)) - hsim385@aucklanduni.ac.nz
- Megha ([@mkoh446](https://github.com/mkoh446)) - mkoh446@aucklanduni.ac.nz
- Nathan ([@nathantheron](https://github.com/nathantheron)) - nthe160@aucklanduni.ac.nz
- Peter ([@Xiayang-Peter](https://github.com/Xiayang-Peter)) - yxia728@aucklanduni.ac.nz
- Sushant Krishnan ([@sushantkrishnan](https://github.com/sushantkrishnan)) - sthi106@aucklanduni.ac.nz
- Zaki ([@Zaki243](https://github.com/Zaki243)) - zabr254@aucklanduni.ac.nz

## What the fork adds

| Part | Where | What it does |
|---|---|---|
| Affect map | `src/lib/affect.ts` | A valence/arousal coordinate for every sound (provisional author ratings; see the file header). |
| Transition engine | `src/lib/transition.ts`, `src/stores/transition.ts` | Moves a point through valence/arousal space along a path shape and renders it as a mix: constant-power, sounds fade in and out from zero, weighted towards the start and target scenes. |
| Mood Transition | toolbar menu, `src/components/modals/transition/` | The listener-facing feature: say how you feel, pick where you want to go, pick a path and a length. |
| Study harness | `/?study`, `src/components/study/`, `src/lib/study.ts` | Researcher setup, counterbalanced conditions, Affect Grid pre/post and check-ins, mood curve, questionnaire, sound-rating block, JSON session logs. |
| Route visualiser | `/?visualise`, `src/components/visualiser/` | Plan a route and see what the engine will play, when and how loud, or open a session log and replay what a participant heard. |
| Analysis | `scripts/analysis/analyse.py` | Turns a folder of session logs into CSVs and a summary following the [analysis plan](docs/proposal-sections.md#44-evaluation-study-design) (§4.4). |
| Study bot | `scripts/study-bot/run.mjs` | Synthetic participants run real sessions in headless Chrome, to test harness → logs → analysis before anyone sits down. |
| Sound libraries | `scripts/libraries/build.py` | Optional third-party affective sound libraries, for comparing maps in the visualiser. |

Everything else (the mixer, presets, timers, PWA) is upstream Moodist.

## Running it

**Requirements:** Node 24 and pnpm 11. Python 3.9 or later (standard library only) for the analysis and library scripts. Google Chrome for the study bot.

```bash
pnpm install
pnpm dev                    # http://localhost:4321 with hot reload
```

A production build, which is what study sessions should use:

```bash
pnpm build                  # writes dist/
pnpm preview                # serves dist/ at http://localhost:4321
```

Or with Docker, which builds this source and serves it with Caddy:

```bash
docker compose up -d --build   # http://localhost:8080
```

Checks:

```bash
pnpm test                   # unit tests (vitest), ~7 s
pnpm check                  # lint and format (biome)
```

All JavaScript dependencies are pinned in `package.json` and `pnpm-lock.yaml`; `pnpm install` fetches them.

## Demo

1. Open the main page. The mixer is Moodist's: pick sounds, set volumes, press play.
2. **Mood Transition** (toolbar menu, or Shift + Alt + M): choose how you feel now and where you want to be on the Affect Grid, then *Guided*, *Straight line* or *Direct*, and 1 to 10 minutes. The mix moves on its own; the mixer shows each sound's level as it changes.
3. **Route visualiser** (button on the main page, or `/?visualise`): pick a start and target and a path shape to see every sound the route will play as a timeline, with the path drawn over the sound map. Press play to hear it.
4. **Study harness** (button on the main page, or `/?study`): the researcher setup screen. Enter a participant ID and start a short session to walk through what a participant sees. The log downloads at the end and can be opened in the visualiser.

## Running the study

[`docs/study-harness.md`](docs/study-harness.md) is the full protocol: preparing the room and device, every setup option and its default, what participants see, what a log contains, and the decisions still open. In short:

1. Build and serve the site (`pnpm build && pnpm preview`, or the Pages deployment) and open `/?study`.
2. Test the whole pipeline with the bot first:

   ```bash
   BASE_URL=http://localhost:4321/ pnpm study:bot     # with pnpm preview running
   pnpm study:analyse .cache/bot-logs
   ```

3. For each session: same room, headphones and device; set the participant ID and session; play the calibration sound and set the device volume once; start and hand over the device.
4. Copy each downloaded log (`moodist-P01-s1.json`) somewhere safe. A backup also stays in the browser.
5. Analyse:

   ```bash
   pnpm study:analyse path/to/logs
   ```

   This writes `analysis/` next to the logs: `sessions.csv`, `probes.csv`, `curves.csv`, `ratings.csv` and `summary.md`.

## Documentation

| File | Contents |
|---|---|
| [`docs/study-harness.md`](docs/study-harness.md) | How to run sessions and analyse them (above). |
| [`docs/proposal-sections.md`](docs/proposal-sections.md) | Project scope, the method for mapping sounds, system overview and the evaluation design, with references. |
| [`docs/proposal.html`](docs/proposal.html) | The proposal, *Path or Destination*. |
| [`docs/affect-map.html`](docs/affect-map.html), `docs/affect-map.svg`, `docs/affect-data.json` | The sound map: every sound's valence/arousal position. |
| [`docs/study-design-slide.html`](docs/study-design-slide.html), `docs/slide-*.svg` | Study design slides and figures. |
| `docs/lit-review/` | Literature review drafts and speaker notes. |

Some research material stays on disk but out of git (see `.gitignore`): published papers and figures taken from them (copyright), rendered PDFs and audio (large and can be regenerated), and third-party sound libraries (licences vary, so they are published deliberately by `scripts/pages/publish.sh`, never committed).

## Publishing

```bash
scripts/pages/publish.sh <owner>/<repo>
```

Builds the site for GitHub Pages under `/<repo>/` and force-pushes it as the `gh-pages` branch of that repository, together with any installed sound libraries. Only the built site is pushed. Each study log records the git commit it was built from, so publish from a clean, committed tree.

## Credits and licence

Built on [Moodist](https://github.com/remvze/moodist) by [Maze](https://github.com/remvze), MIT licensed; this fork keeps the [MIT License](LICENSE).

Moodist's sounds are licensed under the [Pixabay Content License](https://pixabay.com/service/license-summary/) or [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Third-party libraries fetched by `scripts/libraries/build.py` carry their own licences and citations, listed in the `CREDITS.txt` it writes; some are for non-commercial research and teaching only.
