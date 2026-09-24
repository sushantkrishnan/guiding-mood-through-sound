import { AffectGrid, type GridCell } from '@/components/affect-grid';

import styles from './study.module.css';

interface GridStepProps {
  help: string;
  nextLabel?: string;
  /** read-only when not given: the grid only shows `value` */
  onChange?: (cell: GridCell) => void;
  onNext: () => void;
  /** an earlier answer shown as a faint ring (see AffectGrid) */
  reference?: GridCell | null;
  referenceLabel?: string;
  title: string;
  value: GridCell | null;
}

/** One full-screen question answered on the Affect Grid. */
export function GridStep({
  help,
  nextLabel = 'Next',
  onChange,
  onNext,
  reference,
  referenceLabel,
  title,
  value,
}: GridStepProps) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{help}</p>
      <AffectGrid
        label={title}
        reference={reference}
        referenceLabel={referenceLabel}
        value={value}
        onChange={onChange}
      />
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
