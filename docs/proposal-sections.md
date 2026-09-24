# Proposal sections — draft text, scope, and the literature you asked for

Written 21 Aug 2026. Companion to `docs/proposal.html`, which is longer and more ambitious than
what is drafted here. Where the two disagree, this file is the newer thinking, because it takes
account of Brenda's warning and of three experiments that have already run your exact contrast.

---

## 0. Three things to fix before you write anything else

### 0.1 The sound count is wrong

The fork contains **90 sounds** across 9 categories. `docs/affect-data.json` places **89** of them
(`fluorescent-hum` is missing). Counted from `src/data/sounds/*.tsx`:

| category | sounds |
|---|---|
| things | 18 |
| animals | 17 |
| places | 17 |
| nature | 13 |
| rain | 9 |
| urban | 8 |
| transport | 7 |
| binaural | 6 |
| noise | 4 |
| **total** | **90** |

Your "84" is almost certainly 90 minus the 6 binaural beats. If that is a deliberate exclusion,
say so and give the reason — binaural beats are not ambient *scenes*, they are a synthetic tone
manipulation with a separate and contested efficacy literature, and mixing them into a soundscape
map muddies what "ambient sound" means in your RQ. That is a defensible one-line justification.
What is not defensible is a number nobody can reproduce from the repository.

**Decide and state:** 84 (excluding binaural) or 89 (excluding only the unmapped hum) or 90.

### 0.2 Your exact comparison has been run three times, in music, and comes out null

This is the single most important thing to know before you write the evaluation section. Guided
gradual transition versus going straight to the target soundscape is the *iso principle* versus
*direct delivery*, and it has been tested:

| study | n | design | result on affect |
|---|---|---|---|
| Starcke, Mayr & von Georgi 2021 | 107 | sad→sad, sad→happy (iso), happy→happy (direct), happy→sad; 2 × 90 s pieces after a film-clip sadness induction | iso beat sad→sad and happy→sad. Against **happy→happy (the direct control) only descriptive trends**, significant in female participants only |
| Lowe-Brown, Glasser, Wadley & Koval 2026 | 193 | pre-registered: iso vs compensatory (straight to calm songs) vs unguided self-selected | **"iso-principle guided listening was not more effective than compensatory-principle listening"**. Both guided arms beat *unguided* |
| Ding, Fu, Tang & Zhang 2026 | 120 | 5 evening sessions, iso vs direct-uplifting, occupational stress/anxiety/depression | none of the three co-primary comparisons significant. **Completion 90% vs 66.7%, p = .004** |

Read those three rows together and they say something quite precise, which you should put in the
proposal rather than discover in your results:

1. **Do not power your study on an affect difference.** Three studies with n between 107 and 193
   could not find one. A course pilot at n = 12–20 has no chance, and Brenda is telling you the
   same thing from experience.
2. **The difference that does show up is experiential, not affective.** Ding's adherence gap
   (90% vs 67%) is large and significant while the mood outcomes are not. Lowe-Brown's surviving
   effect is *guided beats unguided*, which is about the interface doing the work, not the path.
3. **So your primary outcome should be the experience of the transition**, with affect as an
   honestly-underpowered secondary. That is not a retreat. It is the outcome the literature says
   is actually moving, and it is the outcome an HCI course cares about.

It also tells you what is genuinely new in your project, which is worth stating plainly: all three
studies above sequence **discrete musical tracks**. Yours is **continuous ambient mixing through a
2D affective space** — no track boundaries, no lyrics, no musical expectancy. Nobody has tested
path-versus-destination in that medium or with that interface.

### 0.3 Consider adding an unguided arm if you can afford it

The only significant guided-versus-something effect in the literature is Lowe-Brown's *guided beats
unguided*. If your study is going to find anything at all, that contrast is the likeliest place.
A third arm costs you one more session per participant. If you cannot afford it, say in the
proposal that you considered it and why it was cut — that is exactly the kind of reasoning the
marker is looking for.

---

## 1. How System Overview differs from Project Scope (and from Methodology)

You are right that they overlap. Here is a split that keeps them distinct. The test is the
question each section answers:

| section | question it answers | tense | contains |
|---|---|---|---|
| **Methodology** | *How will we answer the research question?* | future | conditions, the manipulation, procedure, analysis plan |
| **System Overview** | *What is the thing we are building, and how does it work?* | present | architecture, data flow, the components, what already exists vs what we add |
| **Project Scope** | *What are we and are we not committing to?* | commitment | in-scope list, out-of-scope list with reasons, deliverables, assumptions and constraints |

Concretely, the same fact appears in all three but for different purposes:

- Methodology: "the transition runs for 6 minutes, identical duration in both conditions" — because
  it is a *control*.
- System Overview: "a tick driver updates the position at 20 Hz and writes per-sound gains to the
  Zustand store" — because it is *how the thing works*.
- Project Scope: "we will not implement per-user coordinate adaptation" — because it is a *boundary*.

If a sentence does not answer one of those three questions, it belongs in none of them. The
easiest failure here is writing System Overview as a re-narration of the methodology; keep it
about the artefact, and let every claim in it be checkable by opening the repository.

---

## 2. Project Scope

### In scope

- A fork of Moodist with a **transition engine** that moves a position through valence–arousal
  space and renders it as a continuous multi-sound mix.
- An **affect map** of the sound library, with a documented and defensible construction method
  (§4.2).
- A **two-step mood picker**: current state, then target state, both on the same grid, which
  doubles as the pre-measure.
- A **study harness**: condition assignment, timed probes, event logging to JSON.
- A **within-subjects pilot** with a guided-transition condition and a direct-target control.
- A **questionnaire and short interview** covering perceived quality, coherence, and the
  experience of being moved.
- An **analysis** that treats experiential measures as primary and self-reported affect change as
  secondary and underpowered.

### Out of scope, with reasons

| excluded | why |
|---|---|
| Claiming a measured improvement in emotional state | Three larger studies failed to find one against a direct control (§0.2). We report affect descriptively and do not power for it |
| Physiological sensing (chest strap, EDA) | No sensor access confirmed. Adding it late would change the ethics application |
| Webcam facial-expression inference | Listeners hold a near-neutral face during audio-only tasks, so the signal is thin. See §5.3 |
| Per-user adaptation of sound coordinates | A second manipulation the pilot cannot separate from the first |
| Closed-loop biofeedback control | Depends on sensing we do not have, and changes the design from open to closed loop |
| Generalising beyond this sound library | 90 sounds from one app, mostly nature and urban ambience, no music, English-language interface |
| Clinical claims | Non-clinical participants, no diagnostic screening, not a therapeutic intervention |

### Assumptions we are making explicit

1. **Additivity.** We treat the affect of a mix as a weighted combination of its components. This
   is almost certainly false at the margins — rain plus thunder is not the average of rain and
   thunder — and Emo-Soundscapes was built partly to study exactly this. We hold it constant
   across conditions so it cannot confound the comparison, but it bounds what we can claim.
2. **Stable coordinates.** We assume a sound's position does not shift much between listeners.
   Familiarity was a third component in Axelsson's model, and it is person-specific.
3. **Self-report validity.** Our primary measures are self-reported. We are measuring the
   *experience* of a transition, which is the thing self-report is actually good at.

---

## 3. Intro and names

Placeholder — I do not have your HCI group's roster, so fill this in:

> **[Course code] · [Group name/number]** — [Name] ([UPI]), [Name] ([UPI]), [Name] ([UPI]),
> [Name] ([UPI]).
> Supervised by [Brenda's full name and title].

One paragraph after the names, which should say what the project is in two sentences before any
background:

> We are building a soundscape player that moves a listener gradually from the emotional state
> they report to the one they choose, instead of playing the destination immediately. We are
> running a pilot study to find out whether that transition is experienced differently from
> arriving directly.

---

## 4. Section drafts

### 4.1 Motivation

Three claims, each with a source. Do not assert the first one without a citation; it is the one a
marker will push on.

**Sound has a measurable affective structure, and it is two-dimensional.** Russell's circumplex
organises affect along valence and arousal. Independently, Axelsson, Nilsson and Berglund had 100
listeners rate 50 binaural soundscape recordings on 116 attribute scales and recovered
**pleasantness (50% of variance) and eventfulness (18%)**, with familiarity a distant third at 6%.
That two-dimensional structure now underpins **ISO/TS 12913**, so placing ambient sounds in a
shared affective space is standard practice rather than something we invented.

**Sound moves affect, and ambient sound does it with little attentional demand.** Alvarsson, Wiens
and Nilsson exposed 40 participants to nature sound or noise after a mental-arithmetic stressor
and found skin-conductance recovery was faster under nature sound. The mechanism usually invoked
is Attention Restoration Theory: these are low-attentional-demand stimuli. This is the actual
warrant for your "usable in public, does not demand attention" claim — cite it rather than
asserting it. Ambient sound also carries no lyrics and no strong cultural genre binding, which is
the honest version of "universal"; do not overclaim universality, since the norm datasets are
themselves culturally sampled.

**Nobody has tested whether the path matters for ambient sound.** The iso principle — meet the
listener where they are, then move them — has been music therapy practice since Altshuler, and has
been tested experimentally three times against direct delivery (§0.2), always with discrete
musical tracks. Every consumer ambient app, Moodist included, implements the opposite by default:
the destination plays from second one. The gap is narrow and testable.

### 4.2 Methodology — mapping the sounds (the heuristics you asked about)

You have three routes. Pick one as primary and name the others as alternatives; a marker will
reward you for showing you knew there was a choice.

**Route A — anchor to published norms (fastest, most defensible per unit effort).**
Match each Moodist sound to its nearest equivalent in an existing normed corpus and inherit the
coordinates.
- **Emo-Soundscapes** (Fan, Thorogood & Pasquier): 1,213 six-second clips, valence and arousal
  obtained from 1,182 annotators in 74 countries by **crowdsourced pairwise ranking**, and
  explicitly built to study how *mixing* soundscapes changes perceived emotion — directly relevant
  to your additivity assumption.
- **IADS-2 / IADS-E**: the standard normed affective sound sets.
- Weakness: matching is a judgement call, and your `rain-on-tent` is not their `rain`. Document
  the matching rule and have two people do it independently.

**Route B — rate them yourselves with the ISO instrument (most defensible, moderate cost).**
ISO/TS 12913-2 gives a validated 8-attribute questionnaire — *pleasant, vibrant, eventful,
chaotic, annoying, monotonous, uneventful, calm* — and **ISO/TS 12913-3 gives the trigonometric
projection** onto pleasantness and eventfulness, using the 45° spacing between attributes
(pleasant 0°, vibrant 45°, eventful 90°, chaotic 135°, annoying 180°, monotonous 225°, and so on
around the circle). This is the closest thing to an off-the-shelf heuristic that exists, it is a
standard, and the resulting coordinates are directly comparable to the soundscape literature.
Cost: 90 sounds × 8 scales × k raters. With 30-second excerpts and 5 raters that is a few hours
per rater, feasible within the team plus a handful of volunteers.

**Route C — pairwise comparison with a Bradley–Terry fit (most rigorous, highest cost).**
People are unreliable at "rate this 1–9 on pleasantness" and consistent at "which of these two is
more pleasant". This is what Emo-Soundscapes did. A full round-robin on 90 sounds is 4,005 pairs
per dimension, which is too many, so you would use an adaptive or sparse sampling scheme. Only do
this if the affect map is going to be a contribution in its own right.

**Recommendation:** Route B as primary, cross-checked against Route A for the subset of sounds with
a clear norm equivalent. Report the correlation between the two as evidence the map is not
arbitrary. Whatever you pick, state clearly that the coordinates currently in
`docs/affect-data.json` are **author-assigned first-pass values**, adequate to build the engine and
not adequate as study stimuli.

**Psychoacoustic prediction is a fourth route and it is a trap at this scale.** Loudness and
sharpness do predict soundscape pleasantness in the literature, but fitting that model needs the
labelled data you do not have yet. Mention it as future work.

### 4.3 System Overview

Written as *what the artefact is*, not what the study does. Everything here is checkable against
the repository.

> The system is a fork of **Moodist**, an open-source ambient sound web app built with Astro,
> React, Zustand and Howler.js. Forking rather than building from scratch gives us 90 licensed,
> locally-hosted sounds and a working mixer on day one, so effort goes into the manipulation
> rather than the substrate.
>
> **Affect map.** A static table assigns each sound a valence–arousal coordinate
> (`docs/affect-data.json`), constructed as described in §4.2.
>
> **Transition engine.** A tick driver advances a position through valence–arousal space on a
> chosen path shape and renders that position as a mix: a Gaussian kernel over the *k* nearest
> sounds, normalised so the closest sound sits at full gain. Gains are written to the Zustand
> store at 20 Hz.
>
> **Path shapes.** *Direct* (target mix from t = 0, the control), *linear* (straight-line
> interpolation), and *iso* (hold at the reported state, resolve arousal first, then valence).
>
> **Mood picker.** A two-step grid: current state, then target. It doubles as the pre-measure, so
> there is no translation loss between what the user tells the interface and what we record.
>
> **Study harness.** Condition assignment, timed probes, and an event log written to JSON at tick
> rate, so self-report can be aligned to what was actually audible.
>
> **One architectural finding worth reporting.** The store exposes `override()`, which looks like
> the obvious primitive for setting a whole mix at once. It is not usable here: internally it calls
> `unselectAll()`, resetting every volume and deselecting every sound, which at tick rate would
> thrash Howler's play/pause cycle and produce audible dropouts. The engine instead selects the
> union of every sound the trajectory will touch exactly once, then mutates volume only. This also
> solves preloading, since selected sounds load immediately and fade in gaplessly.

Add a small architecture diagram: picker → path planner → tick driver → kernel mix → Zustand store
→ Howler. One figure does more than three paragraphs here.

### 4.4 Evaluation study design

Rewritten around what you can actually measure. Compare this against `proposal.html` §5, which is
more ambitious and assumes a stressor induction and physiological sensing.

**Design.** Within-subjects, order counterbalanced. Two conditions minimum — *guided transition*
and *direct target* — with *unguided* as a third arm if the budget allows (§0.3). Participants are
blind to condition and all conditions are framed identically. Target n = 12–20 for a course pilot.

**Held constant across conditions:** the target mix, the total duration, the interface, the
framing. Only the route varies. This is the design's main strength and the reason a small n is
defensible for the experiential outcomes.

**Confound you should name before the marker does.** The direct condition, by construction,
exposes the participant to the target mix for longer. This biases the comparison *against* the
transition hypothesis, so it is conservative. Report cumulative target exposure per condition.

**Procedure per participant:** consent and baseline → set current state and target state on the
grid → condition runs (6–10 minutes) → post-condition questionnaire → repeat for the other
condition on a separate day, or after a washout → short semi-structured interview at the end.

**Do you need a mood induction?** `proposal.html` proposes a mental-arithmetic stressor so that
everyone starts somewhere comparable. It is the right instinct — participants arriving already
calm have no transition to make — but it costs ethics complexity and time. Given that you are no
longer powering on an affect change, a lighter option is to **let participants self-report their
actual state and treat starting position as a covariate**, recruiting deliberately across a range
of times of day. State which you chose and why.

**Measures, primary first:**

| measure | instrument | when | serves |
|---|---|---|---|
| Perceived coherence | 7-point scale + "did any moment sound wrong?" | post | Does continuous mixing produce plausible scenes? |
| Perceived direction | 7-point: "the soundscape felt like it was going somewhere" | post | The core experiential claim |
| Preference | forced choice between the two sessions | end | The cleanest single number you will get |
| Perceived effectiveness | 7-point | post | Comparable to Lowe-Brown's measure |
| Qualitative account | semi-structured interview, 10 min | end | Explains the numbers; surfaces failures scales miss |
| Valence and arousal | Affect Grid, and SAM as cross-check | pre, every 2 min, post | Secondary. Reported descriptively with CIs, not as a test |
| Adherence / dwell | interaction log | continuous | Free. This is where Ding found the real effect |
| Volume overrides, early exit | interaction log | continuous | Behavioural check against demand characteristics |

**Analysis plan.** Preference and coherence: descriptive plus a sign test. Affect: report
pre-to-post change per condition with confidence intervals and state up front that the pilot is
not powered to detect a between-condition difference. Qualitative: thematic analysis over the
interviews, which for this project is likely to be the section that carries the contribution.

**What a null result buys you.** If the transition is experienced no differently from direct
delivery, that is evidence that the adaptive-transition premise behind a growing category of
wellbeing apps is unnecessary, and that engineering effort is better spent on selection interfaces
than on transition engines. Say this in the proposal, not after the results.

---

## 5. Answers to your specific questions

### 5.1 "Is the direct-target control a valid testing methodology?"

Yes, and you can cite three precedents for it (§0.2). Lowe-Brown's *compensatory* condition — play
the calm songs straight away — is precisely your control, and Ding's *direct-uplifting* arm is the
same idea. Use their language ("direct" vs "mood-matched-to-shifted") so the comparison to prior
work is legible. The important caveat to inherit along with the design: all three found it null on
affect.

### 5.2 "Brenda says don't expect to change emotional state — so maybe just collect comments?"

Brenda is right, and the literature backs her precisely. But "just collect comments" undersells
what you can do. Collect comments *and* the cheap behavioural signals, which cost you nothing once
the harness logs events: dwell time, early exits, volume overrides, and a forced-choice preference
between the two sessions. Ding's study found its only significant effect in exactly this family of
measures. A forced-choice preference at n = 15 is a real, analysable result; "participants said
nice things" is not.

### 5.3 "What can we infer from a webcam?"

Two different things, and they have very different prospects.

- **Facial expression: skip it.** Listeners hold a near-neutral face through audio-only tasks, so
  there is little signal, and what there is will be dominated by lighting and posture. Spending
  study time on it will produce a null you cannot interpret.
- **Remote photoplethysmography (rPPG): plausible as exploratory only.** It recovers heart rate
  from subtle colour changes in the face. Recent reviews are clear about the boundary: rPPG
  reliably captures *average heart rate* at group level, while individual-level HRV estimates
  remain unreliable, and accuracy depends on camera, illumination, encoding, movement and
  background. In a controlled lab session with fixed lighting it is defensible as a secondary
  exploratory measure. Do not make it a primary outcome, and do not use it at all if sessions are
  run remotely.

If you want one physiological signal and can get a sensor, electrodermal activity is a better
arousal correlate than anything a webcam will give you, and it is what Alvarsson used.

---

## 6. References with verification marks

● primary source read this session · ◐ index/metadata confirmed · ◌ search hit only, verify before citing

- ● Starcke, K., Mayr, J., & von Georgi, R. (2021). Emotion modulation through music after sadness
  induction — the iso principle in a controlled experimental study. *IJERPH*, 18(23), 12486.
  doi:10.3390/ijerph182312486
- ● Lowe-Brown, X., Glasser, S., Wadley, G., & Koval, P. (2026). Personalised affect-regulation
  playlists: a pre-registered experimental test of the iso principle in the general population.
  *Musicae Scientiae*. doi:10.1177/10298649261421187
- ● Ding, Y., Fu, W., Tang, Y., & Zhang, D. (2026). State-personalized mood-matched-to-shifted
  versus direct-uplifting music for occupational stress, anxiety, and depressive symptoms: a
  web-based randomized trial. *medRxiv* 2026.08.05.26359641
- ◐ Axelsson, Ö., Nilsson, M. E., & Berglund, B. (2010). A principal components model of soundscape
  perception. *JASA*, 128(5), 2836–2846. doi:10.1121/1.3493436
- ◐ ISO/TS 12913-2:2018 (data collection) and ISO/TS 12913-3:2019 (data analysis, the pleasantness
  / eventfulness projection)
- ◐ Fan, J., Thorogood, M., & Pasquier, P. (2017). Emo-Soundscapes: a dataset for soundscape
  emotion recognition. *ACII 2017*
- ◐ Alvarsson, J. J., Wiens, S., & Nilsson, M. E. (2010). Stress recovery during exposure to nature
  sound and environmental noise. *IJERPH*, 7(3), 1036–1046
- ◐ rPPG limitations: "Remote photoplethysmography in the wild", *Behavior Research Methods* (2024),
  doi:10.3758/s13428-024-02398-0; and the PRISMA-ScR scoping review on rPPG validity for stress and
  workload, *Frontiers in Digital Health* (2026)
- ◐ MoodDJ: designing for emotion regulation in popular music apps, *DIS 2026*.
  doi:10.1145/3800645.3812960 — closest HCI system paper; read it for related work
- ◌ Russell, J. A. (1980). A circumplex model of affect. *JPSP*, 39(6), 1161–1178
- ◌ Russell, Weiss & Mendelsohn (1989), Affect Grid; Bradley & Lang (1994), SAM
- ◌ Bradley & Lang, IADS-2; Yang et al. (2018), IADS-E
- ◌ Juslin & Västfjäll (2008), mechanisms of musical emotion; Gross, process model of emotion
  regulation; Altshuler (1948), the iso principle
