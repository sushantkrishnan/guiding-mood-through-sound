import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AffectGrid,
  cellToPoint,
  type GridCell,
} from '@/components/affect-grid';
import { Setup } from './setup';
import { Questionnaire } from './questionnaire';

import { FADE_OUT } from '@/constants/events';
import { dispatch } from '@/lib/event';
import {
  centroid,
  createLog,
  downloadLog,
  logFilename,
  saveLog,
  targetExposure,
  traceRow,
  type Condition,
  type GridAnswer,
  type Questionnaire as Answers,
  type SessionLog,
  type StudySetup,
} from '@/lib/study';
import { runTransition } from '@/lib/transition';
import { useSettingsStore } from '@/stores/settings';
import { useSoundStore } from '@/stores/sound';
import { useStudyStore } from '@/stores/study';
import { useTransitionStore } from '@/stores/transition';

import styles from './study.module.css';

import type { AffectPoint } from '@/lib/affect';

type Phase =
  | 'setup'
  | 'welcome'
  | 'now'
  | 'target'
  | 'loading'
  | 'listening'
  | 'post'
  | 'questionnaire'
  | 'done';

/** fade applied to whatever is playing when listening ends, every condition */
const FADE_MS = 4000;

const toAnswer = (cell: GridCell): GridAnswer => ({
  grid: cell,
  ...cellToPoint(cell),
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

const minutes = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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
  const [setup, setSetup] = useState<StudySetup | null>(null);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [pre, setPre] = useState<GridCell | null>(null);
  const [target, setTarget] = useState<GridCell | null>(null);
  const [post, setPost] = useState<GridCell | null>(null);
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeCell, setProbeCell] = useState<GridCell | null>(null);
  const [listened, setListened] = useState(0);
  const [backedUp, setBackedUp] = useState(true);

  const log = useRef<SessionLog | null>(null);
  const began = useRef(0);
  const listenedMs = useRef(0);
  const openProbe = useRef<number | null>(null);
  const probeCursor = useRef(0);
  const finished = useRef(false);
  const teardown = useRef<Array<() => void>>([]);

  const event = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      log.current?.events.push({
        t: Math.round(performance.now() - began.current),
        type,
        ...data,
      });
    },
    [],
  );

  const go = useCallback(
    (next: Phase) => {
      event('phase', { phase: next });
      setPhase(next);
    },
    [event],
  );

  const stopAll = useCallback(() => {
    teardown.current.forEach(fn => {
      fn();
    });
    teardown.current = [];
  }, []);

  useEffect(() => stopAll, [stopAll]);

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

  const handleStart = (next: StudySetup, order: Array<Condition>) => {
    stopAll();

    log.current = createLog(next, order);
    began.current = performance.now();
    listenedMs.current = 0;
    openProbe.current = null;
    probeCursor.current = 0;
    finished.current = false;

    setSetup(next);
    setCondition(log.current.condition);
    setPre(null);
    setTarget(null);
    setPost(null);
    setProbeOpen(false);
    setListened(0);

    go('welcome');
  };

  /** Log pauses, volume changes and tab switches while listening. */
  const watchBehaviour = (l: SessionLog) => {
    const unsubscribePlay = useSoundStore.subscribe((state, prev) => {
      if (state.isPlaying === prev.isPlaying) return;
      if (state.isPlaying) return event('play');

      // Moodist pauses by itself whenever nothing is selected; only a pause
      // with sounds still selected is the participant's own
      const auto = state.noSelected();
      if (!auto) l.summary.pauses++;

      event('pause', { auto });
    });

    // a drag on the slider is one change, logged once it settles
    let volumeTimer: ReturnType<typeof setTimeout> | null = null;
    const flushVolume = () => {
      volumeTimer = null;
      l.summary.volumeChanges++;
      event('volume', { value: useSettingsStore.getState().globalVolume });
    };
    const unsubscribeVolume = useSettingsStore.subscribe((state, prev) => {
      if (state.globalVolume === prev.globalVolume) return;
      if (volumeTimer) clearTimeout(volumeTimer);

      volumeTimer = setTimeout(flushVolume, 400);
    });

    const onVisibility = () => event('visibility', { hidden: document.hidden });
    document.addEventListener('visibilitychange', onVisibility);

    teardown.current.push(() => {
      unsubscribePlay();
      unsubscribeVolume();
      document.removeEventListener('visibilitychange', onVisibility);

      if (volumeTimer) {
        clearTimeout(volumeTimer);
        flushVolume();
      }
    });
  };

  const maybeShowProbe = (l: SessionLog, elapsed: number) => {
    if (openProbe.current !== null) return;

    const i = probeCursor.current;
    const probe = l.measures.probes[i];

    if (!probe || elapsed < probe.dueMs) return;

    probe.shownMs = Math.round(elapsed);
    openProbe.current = i;
    event('probe-shown', { index: i });

    setProbeCell(null);
    setProbeOpen(true);
  };

  const answerProbe = () => {
    const l = log.current;
    const i = openProbe.current;

    if (!l || i === null || !probeCell) return;

    const probe = l.measures.probes[i];
    probe.answeredMs = Math.round(listenedMs.current);
    probe.answer = toAnswer(probeCell);
    event('probe-answered', { index: i });

    openProbe.current = null;
    probeCursor.current = i + 1;

    // a probe that fell due while this one was open is skipped, not stacked
    let next = l.measures.probes[probeCursor.current];
    while (next && next.dueMs <= listenedMs.current) {
      event('probe-skipped', { index: next.index });
      probeCursor.current++;
      next = l.measures.probes[probeCursor.current];
    }

    setProbeOpen(false);
  };

  const finishListening = (early: boolean) => {
    const l = log.current;

    if (!l || finished.current) return;

    finished.current = true;
    stopAll();

    l.summary.listenedMs = Math.round(listenedMs.current);

    if (early) {
      l.summary.exitedEarlyMs = l.summary.listenedMs;
      event('exit-early', { listenedMs: l.summary.listenedMs });
    } else {
      event('listening-complete');
    }

    if (openProbe.current !== null) {
      event('probe-abandoned', { index: openProbe.current });
      openProbe.current = null;
      setProbeOpen(false);
    }

    dispatch(FADE_OUT, { duration: FADE_MS });
    setTimeout(() => useSoundStore.getState().unselectAll(), FADE_MS + 200);

    go('post');
  };

  const startListening = async (
    l: SessionLog,
    start: AffectPoint,
    end: AffectPoint,
  ) => {
    const duration = l.config.durationMs;
    const interval = l.config.probeIntervalMs;

    l.measures.probes = [];
    for (let due = interval; due < duration; due += interval) {
      l.measures.probes.push({
        answer: null,
        answeredMs: null,
        dueMs: due,
        index: l.measures.probes.length,
        shownMs: null,
      });
    }

    let lastSecond = -1;
    const tick = (
      elapsed: number,
      position: AffectPoint | null,
      mix: Record<string, number>,
    ) => {
      listenedMs.current = elapsed;
      l.trace.push(traceRow(elapsed, position, mix));
      maybeShowProbe(l, elapsed);

      const second = Math.floor(elapsed / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setListened(elapsed);
      }
    };
    const onComplete = () => finishListening(false);

    watchBehaviour(l);

    if (l.condition === 'unguided') {
      // selecting a sound starts playback, as in the regular app
      useSoundStore.getState().unselectAll();

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
        start,
        target: end,
      });

      // the clock stops only for the participant's own pause. Time spent with
      // nothing selected still counts: they are choosing, which is the task
      const unsubscribe = useSoundStore.subscribe(state => {
        if (!state.isPlaying && !state.noSelected()) handle.pause();
        else handle.resume();
      });

      teardown.current.push(() => {
        handle.cancel();
        unsubscribe();
      });

      return;
    }

    go('loading');
    teardown.current.push(() => useTransitionStore.getState().cancel());

    await useTransitionStore.getState().begin(
      { duration, shape: l.condition, start, target: end },
      {
        onComplete,
        onReady: ({ loadMs, missing }) => {
          l.summary.missingSounds = missing;
          event('ready', { loadMs: Math.round(loadMs), missing });
          go('listening');
        },
        onTick: state => tick(state.elapsed, state.position, state.mix),
      },
    );
  };

  const finishSession = (answers: Answers) => {
    const l = log.current;

    if (!l || !target) return;

    l.measures.questionnaire = answers;
    l.summary.completed = l.summary.exitedEarlyMs === null;
    l.summary.targetExposureMs = targetExposure(l.trace, cellToPoint(target));

    go('done');
    l.endedAt = new Date().toISOString();

    setBackedUp(saveLog(l));
    downloadLog(l);
  };

  const backToSetup = () => {
    stopAll();
    log.current = null;
    setCondition(null);
    setPhase('setup');
  };

  const l = log.current;
  const duration = l?.config.durationMs ?? 0;
  const interval = setup ? setup.probeInterval : 0;
  const lastSession =
    l && l.order.length > 1 && l.session === l.order.length
      ? l.order.length
      : null;

  const probe = probeOpen && (
    <div className={styles.backdrop}>
      <div
        aria-labelledby="study-probe-title"
        aria-modal="true"
        className={styles.probe}
        role="dialog"
      >
        <p className={styles.eyebrow}>Quick check-in</p>
        <h2 className={styles.subtitle} id="study-probe-title">
          How do you feel right now?
        </h2>
        <AffectGrid
          label="How do you feel right now?"
          value={probeCell}
          onChange={setProbeCell}
        />
        <button
          className={styles.primary}
          disabled={!probeCell}
          type="button"
          onClick={answerProbe}
        >
          Continue
        </button>
      </div>
    </div>
  );

  if (!covering) {
    return (
      <>
        <div className={styles.bar}>
          <p>
            <strong>You choose the sounds this time.</strong> Pick and adjust
            sounds below to help you get to how you want to feel.
          </p>
          <Controls
            remaining={duration - listened}
            onEnd={() => finishListening(true)}
          />
        </div>
        {probe}
      </>
    );
  }

  return (
    <div className={styles.overlay}>
      {phase === 'setup' && <Setup onStart={handleStart} />}

      {phase === 'welcome' && setup && (
        <div className={styles.page}>
          <h1 className={styles.title}>Welcome</h1>
          <p className={styles.lead}>
            In this session you will listen to a soundscape for about{' '}
            {setup.duration} minutes. Please put on your headphones and sit
            comfortably.
          </p>
          <p className={styles.lead}>
            First you will tell us how you feel now, and how you would like to
            feel. While you listen, a short check-in will appear every{' '}
            {interval} {interval === 1 ? 'minute' : 'minutes'}. There are no
            right or wrong answers.
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

      {phase === 'target' && (
        <GridStep
          help="Pick the square for the feeling you would like to have by the end of the session."
          nextLabel="Start listening"
          title="How would you like to feel?"
          value={target}
          onChange={setTarget}
          onNext={() => {
            if (!l || !pre || !target) return;
            l.measures.target = toAnswer(target);
            startListening(l, cellToPoint(pre), cellToPoint(target));
          }}
        />
      )}

      {phase === 'loading' && (
        <div className={styles.page}>
          <p className={styles.calm}>Getting the sounds ready…</p>
        </div>
      )}

      {phase === 'listening' && (
        <div className={styles.page}>
          <p className={styles.calm}>Just listen.</p>
          <p className={styles.lead}>
            We will check in with you every {interval}{' '}
            {interval === 1 ? 'minute' : 'minutes'}. You can change the volume
            at any time.
          </p>
          <Controls
            remaining={duration - listened}
            onEnd={() => finishListening(true)}
          />
        </div>
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
            go('questionnaire');
          }}
        />
      )}

      {phase === 'questionnaire' && (
        <div className={styles.page}>
          <h1 className={styles.title}>About this session</h1>
          <Questionnaire sessions={lastSession} onSubmit={finishSession} />
        </div>
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
                : 'The browser backup failed (storage full or blocked), so keep the downloaded file safe.'}
            </p>
            <div className={styles.actions}>
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

interface GridStepProps {
  help: string;
  nextLabel?: string;
  onChange: (cell: GridCell) => void;
  onNext: () => void;
  title: string;
  value: GridCell | null;
}

function GridStep({
  help,
  nextLabel = 'Next',
  onChange,
  onNext,
  title,
  value,
}: GridStepProps) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{help}</p>
      <AffectGrid label={title} value={value} onChange={onChange} />
      <button
        className={styles.primary}
        disabled={!value}
        type="button"
        onClick={onNext}
      >
        {nextLabel}
      </button>
    </div>
  );
}

interface ControlsProps {
  onEnd: () => void;
  remaining: number;
}

/** Shared by every condition, so the controls themselves are not a cue. */
function Controls({ onEnd, remaining }: ControlsProps) {
  const volume = useSettingsStore(state => state.globalVolume);
  const setVolume = useSettingsStore(state => state.setGlobalVolume);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={styles.controls}>
      <span className={styles.remaining}>{minutes(remaining)} left</span>

      <label className={styles.volume}>
        <span>Volume</span>
        <input
          max={100}
          min={0}
          type="range"
          value={Math.round(volume * 100)}
          onChange={e => setVolume(Number(e.target.value) / 100)}
        />
      </label>

      {confirming ? (
        <span className={styles.confirm}>
          End now?
          <button type="button" onClick={onEnd}>
            Yes, end
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep listening
          </button>
        </span>
      ) : (
        <button
          className={styles.link}
          type="button"
          onClick={() => setConfirming(true)}
        >
          End session early
        </button>
      )}
    </div>
  );
}
