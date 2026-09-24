import { useEffect, useRef, useState } from 'react';

import { AffectGrid, type GridCell } from '@/components/affect-grid';

import { toAnswer, type SoundRating } from '@/lib/study';
import { ENGINE_DEFAULTS } from '@/lib/transition';
import { useMixStore } from '@/stores/mix';
import { useSoundStore } from '@/stores/sound';
import { waitForSounds } from '@/stores/transition';

import type { Recorder } from './recorder';

import styles from './study.module.css';

type Stage = 'intro' | 'loading' | 'rating';

interface RatingBlockProps {
  ids: Array<string>;
  onDone: (ratings: Array<SoundRating>) => void;
  recorder: Recorder;
  /** seconds each sound plays before it can be rated */
  seconds: number;
}

/**
 * Listener ratings of the sounds this participant actually heard, one at a
 * time, on the same grid as everything else. They replace the provisional
 * author coordinates for exactly the sounds the study uses, and check per
 * participant whether a route went where it was meant to.
 *
 * Sounds play alone at the engine's master gain and are not named: the
 * rating is of what they hear, not of the label.
 */
export function RatingBlock({
  ids,
  onDone,
  recorder,
  seconds,
}: RatingBlockProps) {
  const [stage, setStage] = useState<Stage>('intro');
  const [index, setIndex] = useState(0);
  const [cell, setCell] = useState<GridCell | null>(null);
  const [ready, setReady] = useState(false);

  const ratings = useRef<Array<SoundRating>>([]);
  const shownAt = useRef(0);

  const begin = async () => {
    setStage('loading');
    recorder.event('ratings-start', { ids });

    useMixStore.getState().clear();
    useSoundStore.getState().prepareMix(ids);
    useSoundStore.getState().play();

    const missing = await waitForSounds(ids);
    recorder.event('ratings-ready', { missing });
    setStage('rating');
  };

  useEffect(() => {
    if (stage !== 'rating') return;

    const id = ids[index];

    useMixStore.getState().setGains({ [id]: ENGINE_DEFAULTS.masterGain });
    shownAt.current = recorder.now();
    recorder.event('rating-shown', { id, index });

    setCell(null);
    setReady(false);

    const timer = setTimeout(() => setReady(true), seconds * 1000);

    return () => clearTimeout(timer);
  }, [stage, index, ids, recorder, seconds]);

  // whatever happens, leave nothing playing
  useEffect(
    () => () => {
      useMixStore.getState().clear();
      useSoundStore.getState().unselectAll();
    },
    [],
  );

  const next = () => {
    if (!cell) return;

    const id = ids[index];
    ratings.current.push({
      answer: toAnswer(cell),
      answeredMs: recorder.now(),
      id,
      index,
      shownMs: shownAt.current,
    });
    recorder.event('rating-answered', { id, index });

    if (index + 1 < ids.length) {
      setIndex(index + 1);
      return;
    }

    useMixStore.getState().clear();
    useSoundStore.getState().unselectAll();
    onDone(ratings.current);
  };

  if (stage === 'intro') {
    const minutes = Math.max(1, Math.round((ids.length * (seconds + 5)) / 60));

    return (
      <div className={styles.page}>
        <h1 className={styles.title}>One last part</h1>
        <p className={styles.lead}>
          You will now hear some of the sounds from your sessions, one at a
          time. For each one, listen, then pick the square for how that sound
          makes you feel. There are {ids.length} sounds, which takes about{' '}
          {minutes} {minutes === 1 ? 'minute' : 'minutes'}.
        </p>
        <button className={styles.primary} type="button" onClick={begin}>
          Start
        </button>
      </div>
    );
  }

  if (stage === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.calm}>Getting the sounds ready…</p>
      </div>
    );
  }

  const last = index + 1 === ids.length;

  return (
    <div className={styles.page}>
      <p className={styles.progressText}>
        Sound {index + 1} of {ids.length}
      </p>
      <h1 className={styles.title}>How does this sound make you feel?</h1>
      <p aria-live="polite" className={styles.lead}>
        {ready
          ? 'Pick the square that fits best, then continue.'
          : 'Listen for a few seconds first.'}
      </p>
      <AffectGrid
        label="How does this sound make you feel?"
        value={cell}
        onChange={setCell}
      />
      <button
        className={styles.primary}
        disabled={!ready || !cell}
        type="button"
        onClick={next}
      >
        {last ? 'Finish' : 'Next sound'}
      </button>
    </div>
  );
}
