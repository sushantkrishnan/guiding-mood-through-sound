import { useMemo, useState } from 'react';

import {
  Modal,
  ModalActions,
  ModalButton,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/modal';
import {
  AffectGrid,
  AffectOverlay,
  cellToPoint,
  type GridCell,
} from '@/components/affect-grid';
import { trajectorySounds, type PathShape } from '@/lib/transition';
import { getSoundLabel } from '@/lib/sounds';
import { useTransitionStore } from '@/stores/transition';
import { cn } from '@/helpers/styles';

import styles from './transition.module.css';

interface TransitionModalProps {
  onClose: () => void;
  show: boolean;
}

type Step = 'now' | 'target' | 'path';

const shapes: Array<{ description: string; id: PathShape; label: string }> = [
  {
    description:
      'Starts where you are, eases your energy first, then your mood.',
    id: 'iso',
    label: 'Guided',
  },
  {
    description: 'Moves at a steady pace in a straight line to your target.',
    id: 'linear',
    label: 'Straight line',
  },
  {
    description: 'Plays your target soundscape straight away.',
    id: 'direct',
    label: 'Direct',
  },
];

const durations = [1, 3, 6, 10];

export function TransitionModal({ onClose, show }: TransitionModalProps) {
  const status = useTransitionStore(state => state.status);

  return (
    <Modal show={show} onClose={onClose}>
      {status === 'idle' ? <Planner onStarted={onClose} /> : <Running />}
    </Modal>
  );
}

function Planner({ onStarted }: { onStarted: () => void }) {
  const begin = useTransitionStore(state => state.begin);

  const [step, setStep] = useState<Step>('now');
  const [now, setNow] = useState<GridCell | null>(null);
  const [target, setTarget] = useState<GridCell | null>(null);
  const [shape, setShape] = useState<PathShape>('iso');
  const [minutes, setMinutes] = useState(3);

  const start = useMemo(() => (now ? cellToPoint(now) : null), [now]);
  const end = useMemo(() => (target ? cellToPoint(target) : null), [target]);

  const onPath = useMemo(
    () => (start && end ? trajectorySounds(start, end, shape) : []),
    [start, end, shape],
  );

  const handleStart = () => {
    if (!start || !end) return;

    begin({ duration: minutes * 60_000, shape, start, target: end });
    onStarted();
  };

  if (step === 'now') {
    return (
      <>
        <ModalHeader>
          <div>
            <ModalTitle>Mood Transition</ModalTitle>
            <ModalDescription>
              Step 1 of 3 · How do you feel right now? Pick the square that fits
              best.
            </ModalDescription>
          </div>
        </ModalHeader>
        <AffectGrid
          label="How do you feel right now?"
          value={now}
          onChange={setNow}
        />
        <ModalActions>
          <ModalButton
            disabled={!now}
            variant="primary"
            onClick={() => setStep('target')}
          >
            Next
          </ModalButton>
        </ModalActions>
      </>
    );
  }

  if (step === 'target') {
    return (
      <>
        <ModalHeader>
          <div>
            <ModalTitle>Mood Transition</ModalTitle>
            <ModalDescription>
              Step 2 of 3 · How would you like to feel?
            </ModalDescription>
          </div>
        </ModalHeader>
        <AffectGrid
          label="How would you like to feel?"
          value={target}
          onChange={setTarget}
        />
        <ModalActions>
          <ModalButton onClick={() => setStep('now')}>Back</ModalButton>
          <ModalButton
            disabled={!target}
            variant="primary"
            onClick={() => setStep('path')}
          >
            Next
          </ModalButton>
        </ModalActions>
      </>
    );
  }

  const same =
    now &&
    target &&
    now.arousal === target.arousal &&
    now.pleasure === target.pleasure;

  return (
    <>
      <ModalHeader>
        <div>
          <ModalTitle>Mood Transition</ModalTitle>
          <ModalDescription>
            Step 3 of 3 · Choose how to get there. This replaces your current
            mix.
          </ModalDescription>
        </div>
      </ModalHeader>

      <fieldset className={styles.shapes}>
        <legend className={styles.legend}>Path</legend>
        {shapes.map(option => (
          <label
            className={cn(styles.shape, shape === option.id && styles.active)}
            key={option.id}
          >
            <input
              checked={shape === option.id}
              className={styles.radio}
              name="shape"
              type="radio"
              value={option.id}
              onChange={() => setShape(option.id)}
            />
            <span className={styles.shapeLabel}>{option.label}</span>
            <span className={styles.shapeDescription}>
              {option.description}
            </span>
          </label>
        ))}
      </fieldset>

      <label className={styles.duration}>
        <span className={styles.legend}>Duration</span>
        <select
          className={styles.select}
          value={minutes}
          onChange={e => setMinutes(Number(e.target.value))}
        >
          {durations.map(d => (
            <option key={d} value={d}>
              {d} {d === 1 ? 'minute' : 'minutes'}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.preview}>
        <AffectGrid
          label="Planned path"
          overlay={
            <AffectOverlay
              onPath={onPath}
              shape={shape}
              start={start}
              target={end}
            />
          }
          value={null}
        />
        <p className={styles.note}>
          {same
            ? 'Start and target are the same square, so every path sounds the same.'
            : `Hollow ring: now. Solid dot: target. This path mixes ${onPath.length} of the sounds.`}
        </p>
      </div>

      <ModalActions>
        <ModalButton onClick={() => setStep('target')}>Back</ModalButton>
        <ModalButton variant="primary" onClick={handleStart}>
          Start
        </ModalButton>
      </ModalActions>
    </>
  );
}

function Running() {
  const status = useTransitionStore(state => state.status);
  const config = useTransitionStore(state => state.config);
  const ids = useTransitionStore(state => state.ids);
  const mix = useTransitionStore(state => state.mix);
  const position = useTransitionStore(state => state.position);
  const t = useTransitionStore(state => state.t);
  const cancel = useTransitionStore(state => state.cancel);

  const playing = useMemo(
    () =>
      Object.entries(mix)
        .filter(([, gain]) => gain > 0.02)
        .sort((a, b) => b[1] - a[1]),
    [mix],
  );

  if (!config) return null;

  const remaining = Math.max(0, Math.ceil(((1 - t) * config.duration) / 1000));
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  const title =
    status === 'loading'
      ? 'Loading sounds…'
      : status === 'complete'
        ? 'You have arrived'
        : 'Transition in progress';

  return (
    <>
      <ModalHeader>
        <div>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>
            {status === 'complete'
              ? 'The target soundscape keeps playing. Adjust it like any other mix.'
              : 'You can close this window. The transition keeps running.'}
          </ModalDescription>
        </div>
      </ModalHeader>

      <AffectGrid
        label="Transition progress"
        overlay={
          <AffectOverlay
            audible={playing.map(([id]) => id)}
            onPath={ids}
            position={position}
            shape={config.shape}
            start={config.start}
            target={config.target}
          />
        }
        value={null}
      />

      <div className={styles.progress}>
        <div className={styles.bar}>
          <div className={styles.fill} style={{ width: `${t * 100}%` }} />
        </div>
        <span className={styles.clock}>{clock}</span>
      </div>

      {playing.length > 0 && (
        <p className={styles.note}>
          Now playing:{' '}
          {playing
            .slice(0, 5)
            .map(([id]) => getSoundLabel(id))
            .join(', ')}
        </p>
      )}

      <ModalActions>
        <ModalButton
          variant={status === 'complete' ? 'primary' : 'default'}
          onClick={cancel}
        >
          {status === 'complete' ? 'New transition' : 'Stop transition'}
        </ModalButton>
      </ModalActions>
    </>
  );
}
