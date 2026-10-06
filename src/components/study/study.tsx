import { useCallback, useEffect, useRef, useState } from 'react';

import type { GridCell } from '@/components/affect-grid';
import { GridStep } from './grid-step';
import { Listening, UnguidedBar } from './listening';
import { CURVE_POINTS, MoodCurve } from './mood-curve';
import { Probe } from './probe';
import { Questionnaire } from './questionnaire';
import { RatingBlock } from './rating-block';
import { Recorder } from './recorder';
import { rememberSetup, Setup } from './setup';

import { FADE_OUT } from '@/constants/events';
import { cellDistance, cellToPoint, distance, fitToPool } from '@/lib/affect';
import { chime } from '@/lib/chime';
import { dispatch } from '@/lib/event';
import { saveLog, savedLogs } from '@/lib/log-store';
import {
  centroid,
  createLog,
  downloadLog,
  logFilename,
  PROBE_TIMEOUT_MS,
  ratingSounds,
  resolveTarget,
  sincePrevious,
  targetExposure,
  toAnswer,
  type Condition,
  type Questionnaire as Answers,
  type ResolvedTarget,
  type SessionLog,
  type SoundRating,
  type StudySetup,
  type TargetSource,
} from '@/lib/study';
import { driftLoops, frameAt, runTransition } from '@/lib/transition';
import { useSettingsStore } from '@/stores/settings';
import { useSoundStore } from '@/stores/sound';
import { useStudyStore } from '@/stores/study';
import { useTransitionStore } from '@/stores/transition';

import styles from './study.module.css';

type Phase =
  | 'setup'
  | 'welcome'
  | 'now'
  | 'target'
  | 'loading'
  | 'listening'
  | 'post'
  | 'curve'
  | 'questionnaire'
  | 'ratings'
  | 'done';

/** fade applied to whatever is playing when listening ends, every condition */
const FADE_MS = 4000;

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

const emptyCurve = () => ({
  energy: new Array<number | null>(CURVE_POINTS).fill(null),
  pleasantness: new Array<number | null>(CURVE_POINTS).fill(null),
});

/** What the participant can actually hear right now, from the sound store. */
function audibleMix() {
  const { isPlaying, sounds } = useSoundStore.getState();
  const mix: Record<string, number> = {};

  if (!isPlaying) return mix;

  Object.entries(sounds).forEach(([id, sound]) => {
    if (sound.isSelected && sound.volume > 0) mix[id] = sound.volume;
  });

  return mix;
}

/**
 * Participant study harness. Mounted by the app but inert unless the page is
 * opened with `?study` in the URL.
 */
export function Study() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).has('study'));
  }, []);

  return enabled ? <Session /> : null;
}

function Session() {
  const setActive = useStudyStore(state => state.setActive);

  const [phase, setPhase] = useState<Phase>('setup');
  const [condition, setCondition] = useState<Condition | null>(null);
  const [pre, setPre] = useState<GridCell | null>(null);
  const [target, setTarget] = useState<GridCell | null>(null);
  const [preset, setPreset] = useState<ResolvedTarget | null>(null);
  const [post, setPost] = useState<GridCell | null>(null);
  const [curve, setCurve] = useState(emptyCurve);
  const [probeOpen, setProbeOpen] = useState(false);
  const [ratingIds, setRatingIds] = useState<Array<string>>([]);
  const [backedUp, setBackedUp] = useState(true);

  const recorder = useRef<Recorder | null>(null);
  /** this browser's earlier logs, for the rating block */
  const history = useRef<Array<SessionLog>>([]);
  const listenedMs = useRef(0);
  const openProbe = useRef<number | null>(null);
  const probeCursor = useRef(0);
  const finished = useRef(false);
  /** performance.now() when the last session's fade-out has fully finished */
  const fadeEndsAt = useRef(0);

  const go = useCallback((next: Phase) => {
    recorder.current?.event('phase', { phase: next });
    setPhase(next);
  }, []);

  useEffect(() => () => recorder.current?.stop(), []);

  // unguided listening is the one phase where the regular mixer must be usable
  const covering = !(phase === 'listening' && condition === 'unguided');

  useEffect(() => {
    setActive(phase !== 'setup');
  }, [phase, setActive]);

  useEffect(() => {
    if (!covering) return;

    const previous = document.body.style.overflowY;
    document.body.style.overflowY = 'hidden';

    return () => {
      document.body.style.overflowY = previous;
    };
  }, [covering]);

  const persist = async () => {
    const r = recorder.current;
    if (r) setBackedUp(await saveLog(r.log));
  };

  const handleStart = (
    next: StudySetup,
    order: Array<Condition>,
    presetTarget: ResolvedTarget | null,
    logs: Array<SessionLog>,
  ) => {
    recorder.current?.stop();

    const log = createLog(next, order);
    log.flags.sincePreviousMs = sincePrevious(
      logs,
      next.participantId,
      next.session,
    );

    recorder.current = new Recorder(log);
    history.current = logs;
    listenedMs.current = 0;
    openProbe.current = null;
    probeCursor.current = 0;
    finished.current = false;

    setCondition(log.condition);
    setPre(null);
    // the participant's own answer only: a fixed target must not show as a
    // preselected square on "How would you like to feel?"
    setTarget(null);
    setPreset(presetTarget);
    setPost(null);
    setCurve(emptyCurve());
    setProbeOpen(false);
    setRatingIds([]);

    recorder.current.event('setup', {
      targetSource: presetTarget?.source ?? 'participant',
    });
    go('welcome');
  };

  /** Move past check-in `i`, answered or not. */
  const closeProbe = (i: number) => {
    const r = recorder.current;

    if (!r) return;

    const { probes } = r.log.measures;
    openProbe.current = null;
    probeCursor.current = i + 1;

    // a probe that fell due while this one was open is skipped, not stacked
    let next = probes[probeCursor.current];
    while (next && next.dueMs <= listenedMs.current) {
      r.event('probe-skipped', { index: next.index });
      probeCursor.current++;
      next = probes[probeCursor.current];
    }

    setProbeOpen(false);
  };

  const maybeShowProbe = (elapsed: number) => {
    const r = recorder.current;

    if (!r) return;

    const open = openProbe.current;

    if (open !== null) {
      const shown = r.log.measures.probes[open].shownMs ?? elapsed;

      if (elapsed - shown >= PROBE_TIMEOUT_MS) {
        r.event('probe-missed', { index: open });
        closeProbe(open);
      }

      return;
    }

    const i = probeCursor.current;
    const probe = r.log.measures.probes[i];

    if (!probe || elapsed < probe.dueMs) return;

    probe.shownMs = Math.round(elapsed);
    openProbe.current = i;
    r.event('probe-shown', { index: i });

    if (r.log.setup.chime) chime(useSettingsStore.getState().globalVolume);

    setProbeOpen(true);
  };

  const answerProbe = (cell: GridCell) => {
    const r = recorder.current;
    const i = openProbe.current;

    if (!r || i === null) return;

    const { probes } = r.log.measures;
    probes[i].answeredMs = Math.round(listenedMs.current);
    probes[i].answer = toAnswer(cell);
    r.event('probe-answered', { index: i });

    closeProbe(i);
  };

  const finishListening = (early: boolean) => {
    const r = recorder.current;

    if (!r || finished.current) return;

    finished.current = true;
    r.flushTrace();
    r.stop();

    const l = r.log;
    l.summary.listenedMs = Math.round(listenedMs.current);

    if (early) {
      l.summary.exitedEarlyMs = l.summary.listenedMs;
      r.event('exit-early', { listenedMs: l.summary.listenedMs });
    } else {
      r.event('listening-complete');
    }

    if (openProbe.current !== null) {
      r.event('probe-abandoned', { index: openProbe.current });
      openProbe.current = null;
      setProbeOpen(false);
    }

    if (l.route) {
      l.summary.targetExposureMs = targetExposure(l.trace, l.route.target);
    }

    dispatch(FADE_OUT, { duration: FADE_MS });
    setTimeout(() => useSoundStore.getState().unselectAll(), FADE_MS + 200);
    fadeEndsAt.current = performance.now() + FADE_MS + 200;

    void persist();
    go('post');
  };

  const startListening = async (
    startCell: GridCell,
    targetCell: GridCell,
    source: TargetSource,
  ) => {
    // the previous session's fade-out ends by pausing the player and
    // clearing every sound, which would stop this session's clock and
    // abandon its route; only possible when sessions follow within seconds
    const settle = fadeEndsAt.current - performance.now();
    if (settle > 0) {
      go('loading');
      await new Promise(resolve => setTimeout(resolve, settle + 100));
    }

    const r = recorder.current;

    if (!r) return;

    const l = r.log;
    const { setup } = l;
    const place = (cell: GridCell) =>
      setup.fitToMap ? fitToPool(cellToPoint(cell)) : cellToPoint(cell);

    const start = place(startCell);
    const end = place(targetCell);
    const route = {
      ...(l.condition === 'drift' ? { drift: driftLoops(start, end) } : {}),
      from: toAnswer(startCell),
      shape: l.condition,
      start,
      target: end,
      to: toAnswer(targetCell),
      toSource: source,
    };
    l.route = route;

    // too close and every condition plays the same thing; flag, don't block
    const apart = cellDistance(startCell, targetCell);
    l.flags.closeStartTarget = apart < setup.minDistance;
    if (l.flags.closeStartTarget) {
      r.event('close-start-target', { cells: round(apart, 2) });
    }

    const duration = l.config.durationMs;

    if (l.condition !== 'unguided') {
      const end = frameAt(duration, {
        duration,
        rampIn: 0,
        shape: l.condition,
        start: route.start,
        target: route.target,
      });
      const played = centroid(end.mix);

      l.flags.targetGap = played ? round(distance(played, route.target)) : null;
    }

    l.measures.probes = l.config.probeTimesMs.map((dueMs, index) => ({
      answer: null,
      answeredMs: null,
      dueMs,
      index,
      shownMs: null,
    }));

    useSettingsStore.getState().setGlobalVolume(setup.startVolume);
    r.event('volume-start', { value: setup.startVolume });

    const tick = (
      elapsed: number,
      position: { arousal: number; valence: number } | null,
      mix: Record<string, number>,
    ) => {
      listenedMs.current = elapsed;
      r.tick(elapsed, position, mix);
      maybeShowProbe(elapsed);
    };
    const onComplete = () => finishListening(false);

    r.watchBehaviour();

    if (l.condition === 'unguided') {
      // selecting a sound starts playback, as in the regular app
      useSoundStore.getState().unselectAll();
      r.watchMixer();

      go('listening');
      document.getElementById('app')?.scrollIntoView({ behavior: 'smooth' });

      // the engine as a pure clock: no sounds, but the same timing and tick
      // rate as the guided conditions
      const handle = runTransition({
        duration,
        ids: [],
        onComplete,
        onTick: state => {
          const mix = audibleMix();
          tick(state.elapsed, centroid(mix), mix);
        },
        rampIn: 0,
        setVolumes: () => {},
        shape: 'direct',
        start: route.start,
        target: route.target,
      });

      // the clock stops only for the participant's own pause. Time spent with
      // nothing selected still counts: they are choosing, which is the task
      const unsubscribe = useSoundStore.subscribe(state => {
        if (!state.isPlaying && !state.noSelected()) handle.pause();
        else handle.resume();
      });

      r.onStop(() => {
        handle.cancel();
        unsubscribe();
      });

      return;
    }

    go('loading');
    r.onStop(() => useTransitionStore.getState().cancel());

    await useTransitionStore.getState().begin(
      {
        duration,
        shape: l.condition,
        start: route.start,
        target: route.target,
      },
      {
        onComplete,
        onReady: ({ loadMs, missing }) => {
          l.summary.missingSounds = missing;
          r.event('ready', { loadMs: Math.round(loadMs), missing });
          go('listening');
        },
        onTick: state => tick(state.elapsed, state.position, state.mix),
      },
    );
  };

  const finish = () => {
    const r = recorder.current;

    if (!r) return;

    r.log.endedAt = new Date().toISOString();
    go('done');
    void persist();
    downloadLog(r.log);
  };

  const finishQuestionnaire = (answers: Answers) => {
    const r = recorder.current;

    if (!r) return;

    const l = r.log;
    l.measures.questionnaire = answers;
    l.summary.completed = l.summary.exitedEarlyMs === null;

    const final = l.session === l.order.length;

    if (l.setup.ratingBlock && final) {
      const own = history.current.filter(
        log =>
          log.participantId === l.participantId && log.session !== l.session,
      );
      const ids = ratingSounds(
        [...own, l],
        l.setup.ratingCount,
        l.participantNumber,
      );

      if (ids.length) {
        void persist();
        setRatingIds(ids);
        go('ratings');
        return;
      }
    }

    finish();
  };

  const finishRatings = (ratings: Array<SoundRating>) => {
    if (recorder.current) recorder.current.log.measures.ratings = ratings;
    finish();
  };

  const backToSetup = () => {
    recorder.current?.stop();
    recorder.current = null;
    setCondition(null);
    setPhase('setup');
  };

  /** The participant's next session, as in the protocol: same visit, no setup. */
  const startNextSession = async () => {
    const done = recorder.current?.log;

    if (!done || done.session >= done.order.length) return;

    const logs = await savedLogs();
    const next = { ...done.setup, session: done.session + 1 };
    const target = resolveTarget(next, logs, done.participantId);

    // `first` mode with no saved first session: the setup screen explains
    if (target === undefined) return backToSetup();

    rememberSetup(next);
    handleStart(next, done.order, target, logs);
  };

  const r = recorder.current;
  const l = r?.log;
  const checkIns = (l?.config.probeTimesMs.length ?? 0) > 0;
  const lastSession =
    l && l.order.length > 1 && l.session === l.order.length
      ? l.order.length
      : null;
  const curveDone = [...curve.energy, ...curve.pleasantness].every(
    v => v !== null,
  );

  const probe = probeOpen && <Probe onAnswer={answerProbe} />;

  if (!covering) {
    return (
      <>
        <UnguidedBar onEnd={() => finishListening(true)} />
        {probe}
      </>
    );
  }

  return (
    <div className={styles.overlay}>
      {phase === 'setup' && <Setup onStart={handleStart} />}

      {phase === 'welcome' && l && (
        <div className={styles.page}>
          <h1 className={styles.title}>Welcome</h1>
          <p className={styles.lead}>
            In this session you will listen to a soundscape for about{' '}
            {l.setup.duration} minutes. Please put on your headphones and sit
            comfortably.
          </p>
          <p className={styles.lead}>
            First you will tell us how you feel now
            {preset?.source === 'first-session'
              ? ''
              : ', and how you would like to feel'}
            .
            {checkIns &&
              ' While you listen, a short question will appear on screen a couple of times.'}{' '}
            There are no right or wrong answers.
          </p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => go('now')}
          >
            Begin
          </button>
        </div>
      )}

      {phase === 'now' && (
        <GridStep
          help="Each square stands for a feeling. Further right is more pleasant, further left more unpleasant. Higher up is more awake and energised, lower down more sleepy and calm. Pick the one square that best matches how you feel."
          title="How do you feel right now?"
          value={pre}
          onChange={setPre}
          onNext={() => {
            if (!l || !pre) return;
            l.measures.pre = toAnswer(pre);
            go('target');
          }}
        />
      )}

      {phase === 'target' && pre && preset?.source === 'first-session' && (
        <GridStep
          help="In your first session you chose the feeling marked on the grid as your goal. This session aims for the same one. The ring shows how you feel now."
          nextLabel="Start listening"
          reference={pre}
          referenceLabel="how you feel now"
          title="Where this session is heading"
          value={preset.cell}
          onNext={() => startListening(pre, preset.cell, preset.source)}
        />
      )}

      {/* with a fixed target the answer is recorded, but the route still
          heads for the fixed cell, the same for everyone */}
      {phase === 'target' && pre && preset?.source !== 'first-session' && (
        <GridStep
          help={
            preset
              ? 'Pick the square for how you would like to feel. The ring shows how you feel now.'
              : 'Pick the square for the feeling you would like to have by the end of the session. The ring shows how you feel now.'
          }
          nextLabel="Start listening"
          reference={pre}
          referenceLabel="how you feel now"
          title="How would you like to feel?"
          value={target}
          onChange={setTarget}
          onNext={() => {
            if (!l || !target) return;
            l.measures.target = toAnswer(target);
            if (preset) startListening(pre, preset.cell, preset.source);
            else startListening(pre, target, 'participant');
          }}
        />
      )}

      {phase === 'loading' && (
        <div className={styles.page}>
          <p className={styles.calm}>Getting the sounds ready…</p>
        </div>
      )}

      {phase === 'listening' && l && (
        <Listening
          checkIns={checkIns}
          chime={l.setup.chime}
          onEnd={() => finishListening(true)}
        />
      )}

      {phase === 'post' && (
        <GridStep
          help="The listening part is over."
          title="How do you feel right now?"
          value={post}
          onChange={setPost}
          onNext={() => {
            if (!l || !post) return;
            l.measures.post = toAnswer(post);
            go(l.setup.moodCurve ? 'curve' : 'questionnaire');
          }}
        />
      )}

      {phase === 'curve' && (
        <div className={styles.page}>
          <h1 className={styles.title}>How did you feel over the session?</h1>
          <p className={styles.lead}>
            For each box, draw a line from the start of listening to the end:
            drag across it, or move each point with the arrow keys. It does not
            need to be exact.
          </p>

          <h2 className={styles.subtitle}>How pleasant did you feel?</h2>
          <MoodCurve
            high="Very pleasant"
            label="How pleasant you felt"
            low="Very unpleasant"
            values={curve.pleasantness}
            onChange={pleasantness => setCurve(c => ({ ...c, pleasantness }))}
          />

          <h2 className={styles.subtitle}>
            How awake or energised did you feel?
          </h2>
          <MoodCurve
            high="Very energised"
            label="How energised you felt"
            low="Very sleepy"
            values={curve.energy}
            onChange={energy => setCurve(c => ({ ...c, energy }))}
          />

          <button
            className={styles.primary}
            disabled={!curveDone}
            type="button"
            onClick={() => {
              if (!l || !curveDone) return;
              l.measures.curve = {
                energy: curve.energy as Array<number>,
                pleasantness: curve.pleasantness as Array<number>,
              };
              r?.event('curve-answered');
              go('questionnaire');
            }}
          >
            Next
          </button>
        </div>
      )}

      {phase === 'questionnaire' && (
        <div className={styles.page}>
          <h1 className={styles.title}>About this session</h1>
          <Questionnaire
            sessions={lastSession}
            onSubmit={finishQuestionnaire}
          />
        </div>
      )}

      {phase === 'ratings' && r && (
        <RatingBlock
          ids={ratingIds}
          recorder={r}
          seconds={r.log.setup.ratingSeconds}
          onDone={finishRatings}
        />
      )}

      {phase === 'done' && l && (
        <div className={styles.page}>
          <h1 className={styles.title}>Thank you</h1>
          <p className={styles.lead}>
            That is the end of this session. Please let the researcher know you
            have finished.
          </p>

          <section className={styles.researcher}>
            <p className={styles.eyebrow}>For the researcher</p>
            <p>
              Downloaded <code>{logFilename(l)}</code>.{' '}
              {backedUp
                ? 'A backup copy is saved in this browser.'
                : 'The browser backup failed (storage blocked), so keep the downloaded file safe.'}
            </p>
            {l.flags.closeStartTarget && (
              <p className={styles.warning}>
                Start and target were under {l.setup.minDistance} cells apart,
                so this session may not separate the conditions. It is flagged
                in the log.
              </p>
            )}
            {l.flags.targetGap !== null && l.flags.targetGap > 0.4 && (
              <p className={styles.warning}>
                The map is sparse near this target: the mix played there sits{' '}
                {l.flags.targetGap.toFixed(2)} from it.
              </p>
            )}
            <div className={styles.actions}>
              {l.session < l.order.length && (
                <button type="button" onClick={startNextSession}>
                  Start session {l.session + 1} for {l.participantId}
                </button>
              )}
              <button type="button" onClick={() => downloadLog(l)}>
                Download again
              </button>
              <button type="button" onClick={backToSetup}>
                Back to setup
              </button>
            </div>
          </section>
        </div>
      )}

      {probe}
    </div>
  );
}
