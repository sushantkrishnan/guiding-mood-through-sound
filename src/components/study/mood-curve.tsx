import { useRef } from 'react';

import { cn } from '@/helpers/styles';

import styles from './study.module.css';

/** moments from start to end of the session */
export const CURVE_POINTS = 9;

const MIN = 1;
const MAX = 9;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

const moment = (i: number) =>
  i === 0
    ? 'at the start'
    : i === CURVE_POINTS - 1
      ? 'at the end'
      : `${Math.round((i / (CURVE_POINTS - 1)) * 100)}% of the way through`;

interface MoodCurveProps {
  high: string;
  /** the question, used to name each point for screen readers */
  label: string;
  low: string;
  onChange: (values: Array<number | null>) => void;
  values: Array<number | null>;
}

/**
 * Retrospective mood curve, after Kujala et al.'s (2011) UX Curve: the
 * participant draws how a feeling changed across the session. Drag across
 * the box to draw, or set each point with the arrow keys. Scored 1..9 like
 * the Affect Grid.
 */
export function MoodCurve({
  high,
  label,
  low,
  onChange,
  values,
}: MoodCurveProps) {
  const plot = useRef<HTMLDivElement>(null);
  const handles = useRef<Array<HTMLButtonElement | null>>([]);
  const latest = useRef(values);
  const lastIndex = useRef<number | null>(null);
  const drawing = useRef(false);

  latest.current = values;

  const set = (index: number, value: number) => {
    const next = [...latest.current];
    const from = lastIndex.current;
    const fromValue = from === null ? null : next[from];

    // a fast stroke skips columns; fill them in along the stroke
    if (from !== null && fromValue !== null && from !== index) {
      const step = index > from ? 1 : -1;

      for (let i = from + step; i !== index; i += step) {
        next[i] = Math.round(
          fromValue + (value - fromValue) * ((i - from) / (index - from)),
        );
      }
    }

    next[index] = value;
    latest.current = next;
    onChange(next);
  };

  const paint = (e: React.PointerEvent) => {
    const rect = plot.current?.getBoundingClientRect();

    if (!rect) return;

    const index = clamp(
      Math.round(((e.clientX - rect.left) / rect.width) * (CURVE_POINTS - 1)),
      0,
      CURVE_POINTS - 1,
    );
    const value = clamp(
      Math.round(MAX - ((e.clientY - rect.top) / rect.height) * (MAX - MIN)),
      MIN,
      MAX,
    );

    set(index, value);
    lastIndex.current = index;
  };

  const handleKey = (i: number) => (e: React.KeyboardEvent) => {
    const current = values[i];
    const moves: Record<string, () => void> = {
      ArrowDown: () => set(i, clamp((current ?? 5) - 1, MIN, MAX)),
      ArrowLeft: () => handles.current[i - 1]?.focus(),
      ArrowRight: () => handles.current[i + 1]?.focus(),
      ArrowUp: () => set(i, clamp((current ?? 5) + 1, MIN, MAX)),
      End: () => set(i, MAX),
      Home: () => set(i, MIN),
    };
    const move = moves[e.key];

    if (!move) return;

    e.preventDefault();
    lastIndex.current = null;
    move();
  };

  const x = (i: number) => (i / (CURVE_POINTS - 1)) * 100;
  const y = (v: number) => ((MAX - v) / (MAX - MIN)) * 100;

  const line = values
    .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.curve}>
      <div aria-hidden="true" className={styles.curveScale}>
        <span>{high}</span>
        <span>{low}</span>
      </div>

      <div
        className={styles.curvePlot}
        ref={plot}
        onPointerDown={e => {
          drawing.current = true;
          lastIndex.current = null;
          e.currentTarget.setPointerCapture(e.pointerId);
          paint(e);
        }}
        onPointerMove={e => drawing.current && paint(e)}
        onPointerUp={() => {
          drawing.current = false;
          lastIndex.current = null;
        }}
      >
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <line
            className={styles.curveMid}
            vectorEffect="non-scaling-stroke"
            x1="0"
            x2="100"
            y1="50"
            y2="50"
          />
          {line && (
            <polyline
              className={styles.curveLine}
              points={line}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {values.map((v, i) => (
          <button
            aria-label={`${label}, ${moment(i)}`}
            aria-valuemax={MAX}
            aria-valuemin={MIN}
            aria-valuenow={v ?? undefined}
            aria-valuetext={v === null ? 'not set' : `${v} of 9`}
            className={cn(styles.handle, v === null && styles.unset)}
            key={i}
            ref={el => {
              handles.current[i] = el;
            }}
            role="slider"
            style={{ left: `${x(i)}%`, top: `${y(v ?? 5)}%` }}
            type="button"
            onKeyDown={handleKey(i)}
          />
        ))}
      </div>

      <div aria-hidden="true" className={styles.curveTime}>
        <span>Start of listening</span>
        <span>End</span>
      </div>
    </div>
  );
}
