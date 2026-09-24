import { useRef } from 'react';

import { cn } from '@/helpers/styles';

import styles from './affect-grid.module.css';

import type { AffectPoint } from '@/lib/affect';

/**
 * One cell of Russell, Weiss & Mendelsohn's (1989) Affect Grid, scored 1..9
 * on each axis as in the original instrument.
 */
export interface GridCell {
  arousal: number;
  pleasure: number;
}

const SIZE = 9;
const MID = 5;

/** Grid scores (1..9) → engine coordinates (-1..+1). */
export function cellToPoint(cell: GridCell): AffectPoint {
  return {
    arousal: (cell.arousal - MID) / (MID - 1),
    valence: (cell.pleasure - MID) / (MID - 1),
  };
}

/** Engine valence (-1..+1) → x in grid units, where the grid is 0..9 wide. */
export function gridX(valence: number) {
  return (MID - 1) * valence + SIZE / 2;
}

/** Engine arousal (-1..+1) → y in grid units, top = high arousal. */
export function gridY(arousal: number) {
  return SIZE / 2 - (MID - 1) * arousal;
}

interface AffectGridProps {
  /** accessible name for the whole grid, usually the question being asked */
  label: string;
  onChange?: (cell: GridCell) => void;
  /** SVG drawn over the cells in grid units (viewBox 0 0 9 9) */
  overlay?: React.ReactNode;
  /** draw the selected cell's dot; off when the overlay marks it instead */
  showValue?: boolean;
  value: GridCell | null;
}

const rows = Array.from({ length: SIZE }, (_, i) => SIZE - i);
const columns = Array.from({ length: SIZE }, (_, i) => i + 1);

export function AffectGrid({
  label,
  onChange,
  overlay,
  showValue = true,
  value,
}: AffectGridProps) {
  const cells = useRef<Record<string, HTMLButtonElement | null>>({});
  const readOnly = !onChange;

  const focusTarget = value ?? { arousal: MID, pleasure: MID };

  const select = (cell: GridCell) => {
    if (!onChange) return;

    onChange(cell);
    cells.current[`${cell.pleasure}-${cell.arousal}`]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
    };
    const move = moves[e.key];

    if (!move || readOnly) return;

    e.preventDefault();

    const clamp = (n: number) => Math.min(SIZE, Math.max(1, n));

    select({
      arousal: clamp(focusTarget.arousal + move[1]),
      pleasure: clamp(focusTarget.pleasure + move[0]),
    });
  };

  return (
    <div className={styles.wrapper}>
      <div aria-hidden="true" className={styles.edge}>
        <span>Stress</span>
        <span className={styles.axis}>High arousal</span>
        <span>Excitement</span>
      </div>

      <div className={styles.middle}>
        <span aria-hidden="true" className={cn(styles.side, styles.left)}>
          Unpleasant feelings
        </span>

        <div className={styles.board}>
          <div
            aria-label={label}
            aria-readonly={readOnly}
            className={cn(styles.grid, readOnly && styles.readOnly)}
            role="radiogroup"
            onKeyDown={handleKeyDown}
          >
            {rows.map(arousal =>
              columns.map(pleasure => {
                const checked =
                  value?.arousal === arousal && value?.pleasure === pleasure;
                const isFocusTarget =
                  focusTarget.arousal === arousal &&
                  focusTarget.pleasure === pleasure;

                return (
                  <button
                    aria-checked={checked}
                    aria-label={`Pleasantness ${pleasure} of 9, arousal ${arousal} of 9`}
                    className={cn(
                      styles.cell,
                      checked && showValue && styles.checked,
                      pleasure === MID && styles.midColumn,
                      arousal === MID && styles.midRow,
                    )}
                    disabled={readOnly}
                    key={`${pleasure}-${arousal}`}
                    ref={el => {
                      cells.current[`${pleasure}-${arousal}`] = el;
                    }}
                    role="radio"
                    tabIndex={isFocusTarget ? 0 : -1}
                    type="button"
                    onClick={() => select({ arousal, pleasure })}
                  />
                );
              }),
            )}
          </div>

          {overlay && (
            <svg
              aria-hidden="true"
              className={styles.overlay}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
            >
              {overlay}
            </svg>
          )}
        </div>

        <span aria-hidden="true" className={cn(styles.side, styles.right)}>
          Pleasant feelings
        </span>
      </div>

      <div aria-hidden="true" className={styles.edge}>
        <span>Depression</span>
        <span className={styles.axis}>Sleepiness</span>
        <span>Relaxation</span>
      </div>
    </div>
  );
}
