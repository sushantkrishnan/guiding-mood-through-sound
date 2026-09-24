# Literature Review — speaker notes & to-do

Companion to `lit-review-draft2.html` / `.pdf` (current) and `lit-review-draft1.*` (kept for reference). Re-render after editing with:

```bash
cd docs/lit-review && python3 render-pdf.py "$PWD/lit-review-draft2.html" "$PWD/lit-review-draft2.pdf"
```

## Draft 2 (21 Sep) — what changed

Feedback on draft 1: too dense. Draft 2 keeps the same nine slides in the same order (so the script below still maps 1:1) and the same look, but cuts each slide to one idea, one figure and short lines at larger type:

- **Per-slide text roughly halved.** Two or three points per slide, each a heading plus one sentence. Body type 31 px (was 24–26).
- **Metadata strips dropped** (dataset sizes, feature counts, participant demographics). Say them aloud if asked; they're in the corrections list below.
- **02** — two steps instead of three; evaluation moved to 03. Fig. 2 alone.
- **03** — headline carries the "not on listeners" point. Two findings, each paired with its figure (Fig. 1 map density, Fig. 6 K trade-off). Proposed listener study is the footer.
- **04** — loop diagram redrawn larger; practitioner photo dropped (spare in `figures/`).
- **05** — two big stat tiles + one point (rode the rhythm, not the feedback → information vs immersion). Four-theme tree dropped; name the themes aloud if needed.
- **06** — comparison table → two cards: "has the path" / "has the listeners", three attributes each plus the gap. Shared assumption and our gap in the footer.
- **07** — six implications → three (path on a dense map; keep it one scene; run the listener test).

Draft 1's slide-by-slide figure table and the corrections list below still apply.

## Paper choice (updated after the group chat)

Teammates have claimed: MoodDJ (Zaki, Azu), RainMind (Zaki), Sonora (Azu), Unwind (Nathan), Affective Audio Dataset (Nathan). So MoodDJ was swapped out. Current pair:

- **Article 1 — Gaur & Donnelly (2024), LNCS 14633 (EvoMUSART 2024).** The one paper about the project's exact mechanism: a smooth path through valence–arousal space from a start state to a desired one. Your group's project-plan deck already cites the 2022 AHFE version (“Donnelly & Gaur (2022) step a listener between two moods, song by song”); the 2024 LNCS version is the peer-reviewed one in an explicitly accepted venue.
  - **Caveat to raise on Piazza / with the lecturer:** it is an algorithm paper with an offline evaluation, not a user study. The brief says LNCS is acceptable, and Nathan's IEEE TAC dataset paper is the same kind of choice, but confirm it counts as “HCI” for this course. If it is rejected, the fallback is **Chen, Chang, Hsu & Chen (2026), *Reacquainting with Everyday Urban Nature: Exploring Natural Soundscape Restoration with Personal Audio AR*, CHI 2026, pp. 1–17, https://doi.org/10.1145/3772318.3791961** — unambiguously HCI, three in-situ studies (n = 16, 16, 12), composes ambient biophony from map data.
- **Article 2 — Cochrane, Loke, Campbell & Ahmadpour (2020), OzCHI 2020.** Unchanged; nobody else has it.

Why they pair well: one has the *path* but no listeners; the other has *listeners* but no path. Neither tests guided vs direct with people, and neither steers a continuous ambient mix — that's the gap the pilot fills.

## Status (15 Sep)

Both papers are in this folder (`document.pdf` = Gaur & Donnelly 2024; `3441000.3441052.pdf` = Mediscape). Every claim on the slides has been checked against the full text, and the paper figures are extracted to `figures/` and placed:

| Slide | Figures |
|---|---|
| 02 | G&D Fig. 2 — example playlist path (sad → happy), large |
| 03 | G&D Fig. 6 — smoothness vs K (main result); Fig. 1 — Deezer map with dense happy/sad clusters |
| 04 | Own loop diagram + Mediscape Fig. 1 — practitioner with Muse headset |
| 05 | Stat tiles (PSS, WHO-5) + themes tree redrawn from Mediscape Fig. 5 (the original's text was too small to read on a slide) |

(The earlier stage-1/stage-2 sketch was dropped to give Fig. 2 the full width; the text on slide 02 explains the two stages. Spare extracted figures — Mediscape session outline and state diagram, G&D Fig. 7 — are in `figures/` if you want to swap any in.)

Corrections made when reading the full text (so you aren't caught out in Q&A):
- G&D: cosine is *not* smoother than Euclidean in the LNCS version (that was the thesis); Euclidean/Manhattan are best on both smoothness and evenness in audio space. The "diagonal moves are smoother" and "shorter playlists are smoother" claims are thesis-only — dropped. The LNCS paper's extra finding is the K trade-off (Fig. 6) and that PCA hurts evenness. 120,000 playlists = 100 songs/quadrant × 12 ordered quadrant pairs. Their proposed listener study: report mood → listen → report after each song.
- Mediscape: hardware is a **Muse** headset + Sennheiser headphones → Muse Monitor → Max 8. One 25-min session (5-min guided intro, 15-min meditation, concluding state). PSS is scored so **40 = no stress**: 37 → 39 (t(19) = 3.82, p < .01); WHO-5 60 → 80 (t(19) = 4.03, p < .01). The three guidelines are (1) understanding mindfulness states: focus vs mind-wandering, (2) emulating the rhythm of the breath in sound, (3) predictability: information vs immersion — "minimise distractions" was never a guideline. Notable: participants "did not seem to rely on the feedback to know if they were succeeding" — they just used the wave rhythm.

Still open: none required. Optional — one-line Piazza check that the LNCS paper counts as HCI (fallback in the section above).

## 4-minute script (draft 2 · ≈ 600 words · plain language)

Timings assume a relaxed 150 words a minute. Cumulative time in brackets so you can check yourself mid-run.

**Title (5 s) [0:05]**
"Hi, I'm Sushant. This is the literature review for Guiding Mood Through Sound."

**01 Our project (30 s) [0:35]**
"Quick context first. Our project builds on Moodist, an open-source ambient sound mixer. We give each of its 84 sounds a place on a mood map: how pleasant it feels, and how energising. Instead of jumping straight to a target soundscape, a transition walks you there, cross-fading sounds along the way. Our pilot compares two routes to the same target: a guided path, and direct arrival. Same target, same time. Only the route differs."

**02 Gaur & Donnelly — what it is (35 s) [1:10]**
"The first paper is Gaur and Donnelly, 2024, in Lecture Notes in Computer Science. They generate playlists as a path through mood space. You give it a start song, a destination, and a length. It then works in two steps. Step one: aim one even step along a straight line toward the destination. Step two: from the songs nearest that point, pick the one that sounds most like the last. So the mood moves, but the music never lurches. In the figure, each dot is one song on the way from sad to happy."

**03 Gaur & Donnelly — what they found (35 s) [1:45]**
"They tested this on 120,000 generated playlists, but never with a listener. Two findings matter for us. First, the map matters most. Smooth paths run between the dense clusters, where there are many songs to choose from. Where the map is sparse, the path jumps. Second, the number of candidate songs is a dial: more candidates means smoother sound, but a less smooth mood path. They end by proposing a listener study: report your mood, listen, report again after each song. It has not been run."

**04 Mediscape — what it is (30 s) [2:15]**
"The second paper is Mediscape, from OzCHI 2020. No music this time. It is one continuous ocean soundscape — waves, birds and wind — built to help beginners meditate. And it listens to you. An EEG headband reads how settled you are. As you settle, the waves slow to a four-second breathing rhythm, and the birds and wind fade. If your mind drifts, they come back. The sound guides your breathing, and your state guides the sound."

**05 Mediscape — what they found (30 s) [2:45]**
"Twenty beginners did one 25-minute session, with questionnaires before and after. Stress went down and wellbeing went up — on the WHO-5, from 60 to 80. Both changes were significant. The interviews added one detail that matters for us. People felt calmer, but most of them simply breathed with the waves. They were not reading the sound as feedback about their state. So the authors' guideline is: balance information against immersion."

**06 How they relate (30 s) [3:15]**
"Side by side, they are two halves of our idea. Gaur and Donnelly have the path — but never played it to a person. Mediscape has the listeners — a continuous ambient scene that measurably changed how twenty people felt — but no path to compare against. Both assume that mood is a position, and that sound can move you through it gradually. Neither plays a guided path to listeners. Neither moves a mix of ambient sounds across a mood map. That gap is our pilot."

**07 Implications (40 s) [3:55]**
"Three things this means for our pilot. One: build the path one step at a time, on a dense map. Gaur and Donnelly's rule is what our engine already does. But sparse regions jump, so before we test we check the map is well covered along each study path. Two: keep it one scene. Mediscape's listeners ignored the feedback and followed the rhythm. Our transition should be audibly going somewhere without breaking immersion. Three: run the listener test both papers leave open. Report mood, listen, report again. We lead with preference, sense of direction and coherence, and report the mood change itself descriptively."

**08 References (5 s) [4:00]**
"References are in APA. Thank you."

Plain-language choices, so you don't slip back into paper-speak under pressure:

| Say | Not |
|---|---|
| mood map · how pleasant, how energising | valence–arousal space · Russell's circumplex |
| the number of candidate songs is a dial | K, K-nearest-neighbour |
| sounds most like the last | audio-feature distance, Euclidean / Manhattan |
| dense clusters · where the map is sparse | data density, quadrant pairs |
| an EEG headband reads how settled you are | Muse, alpha/theta, inferred meditation state |
| stress went down, wellbeing went up, both significant | PSS 37 → 39, t(19) = 3.82 (the tiles show it) |
| keep it one scene | predictability guideline, information-vs-immersion trade-off |

Keep the numbers on the slides; say them only if asked.

## 5-minute script (draft 1 — superseded)

**01 Context (30 s).** "Our project extends Moodist. Every ambient sound sits on a valence–arousal map. Instead of jumping to a target soundscape, a transition engine walks you there, cross-fading sounds along the way. The pilot compares that guided path with direct arrival, and treats the *experience* of the transition as the primary outcome."

**02 Gaur & Donnelly — design (40 s).** "First paper: Gaur and Donnelly, 2024, in Lecture Notes in Computer Science. They generate playlists as a path through valence–arousal space. Given a start song, a destination and a length, each step aims at a point one even step along the straight line, finds the K nearest songs to that point, and then — stage two — picks the one whose audio features change most smoothly, so the mood moves without genre whiplash. It's our transition engine, written for songs."

**03 Gaur & Donnelly — results (40 s).** "They evaluated it as geometry: 120,000 playlists per setting across every quadrant pair, scored on smoothness — how straight the path is — and evenness — how equal the steps are. Euclidean and Manhattan gave the best audio paths, but the metric made no difference to mood — stage one had already fixed that. The bigger findings are about the map and K: the smoothest playlists run between the two dense regions, sparse regions risk jarring jumps, and raising K trades mood smoothness for audio smoothness. No listeners yet — they propose a study where people report mood, listen, and report after each song."

**04 Mediscape — design (35 s).** "Second paper: Mediscape, OzCHI 2020. Different medium — no music at all. One ocean soundscape of waves, birds and wind, driven by a Muse EEG headband. As the meditator settles, the waves slow toward a four-second breathing rhythm and the birds and wind fade; get distracted and they come back. The sound does two jobs: its rhythm entrains breathing, and it feeds back the inferred state."

**05 Mediscape — results (35 s).** "20 novices, one 25-minute session. Perceived stress improved and wellbeing rose from 60 to 80 on the WHO-5, both p < .01. The interviews gave four themes — shifting state, attention, self-regulation strategy, immersion — and, interestingly, most people rode the rhythm rather than reading it as feedback. That feeds the third guideline: balance information against immersion."

**06 Relation (40 s).** "They're the two halves of our idea. One has the path but never played it to a person; the other played a continuous soundscape to people but had no path to compare. Both treat mood as a position in a space that sound can move through gradually. Neither tests guided against direct, and neither mixes ambient sounds through an affect map — that's our gap."

**07 Implications (50 s).** Pick three to say aloud: (1) the one-step-at-a-time rule is a spec for our tick driver; (2) audit the affect map's density along each study path — sparse regions will produce audible jumps; (3) smoothness and evenness come free from our event log, so we can pair objective path quality with perceived coherence; (5) our pilot is the listener test both papers leave open — Gaur & Donnelly even sketch our probe design; (6) information must not break immersion.

**08 References (5 s).** "References are in APA; Article 1 is in LNCS, Article 2 in the ACM Digital Library."
