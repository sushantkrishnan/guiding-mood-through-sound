import { useState } from 'react';

import { AffectGrid, type GridCell } from '@/components/affect-grid';

import styles from './study.module.css';

interface ProbeProps {
  onAnswer: (cell: GridCell) => void;
}

/**
 * The in-session check-in. Audio keeps playing underneath. It never shows
 * the previous answer: seeing it anchors the next one.
 */
export function Probe({ onAnswer }: ProbeProps) {
  const [cell, setCell] = useState<GridCell | null>(null);

  return (
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
          value={cell}
          onChange={setCell}
        />
        <button
          className={styles.primary}
          disabled={!cell}
          type="button"
          onClick={() => cell && onAnswer(cell)}
        >
          Continue listening
        </button>
      </div>
    </div>
  );
}
