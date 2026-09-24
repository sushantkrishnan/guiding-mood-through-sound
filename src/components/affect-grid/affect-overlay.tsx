import { useMemo } from 'react';

import { affect, type AffectMap, type AffectPoint } from '@/lib/affect';
import { getSoundLabel } from '@/lib/sounds';
import {
  pathPosition,
  type PathShape,
  type TransitionOptions,
} from '@/lib/transition';

import { gridX, gridY } from './affect-grid';

import styles from './affect-overlay.module.css';

export interface Report {
  label: string;
  point: AffectPoint;
}

interface AffectOverlayProps {
  /** ids currently audible, drawn brighter */
  audible?: Array<string>;
  /** draw the path as the chart's main series rather than a faint preview */
  emphasis?: boolean;
  /** ids drawn in the highlight colour, e.g. one library's sounds */
  highlight?: Set<string>;
  /** ids to name on the map, most important first; colliding ones are dropped */
  labels?: Array<string>;
  /** ids the path will touch, drawn slightly brighter than the rest */
  onPath?: Array<string>;
  /** engine options the path is drawn with (hold, dwell, drift loops…) */
  options?: TransitionOptions;
  /** the sounds to draw; Moodist's library when not given */
  pool?: AffectMap;
  position?: AffectPoint | null;
  /** self-reported states, joined in order (a second series) */
  reports?: Array<Report>;
  shape?: PathShape;
  showSounds?: boolean;
  start?: AffectPoint | null;
  target?: AffectPoint | null;
  /** an explicit path, e.g. a recorded trace; overrides `shape` */
  trail?: Array<AffectPoint>;
}

// enough for drift's loops to read as loops
const PATH_SAMPLES = 240;

/** rough text metrics in grid units, for the 0.3-unit label size */
const CHAR_WIDTH = 0.16;
const LINE_HEIGHT = 0.32;

interface Box {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** A label's box when its baseline starts at (x, y). */
const labelBox = (x: number, y: number, text: string): Box => ({
  x1: x,
  x2: x + text.length * CHAR_WIDTH,
  y1: y - LINE_HEIGHT * 0.8,
  y2: y + LINE_HEIGHT * 0.2,
});

const toPoints = (points: Array<AffectPoint>) =>
  points.map(p => `${gridX(p.valence)},${gridY(p.arousal)}`).join(' ');

/**
 * SVG layer for `AffectGrid`'s `overlay` prop: the sound library at its
 * affect coordinates, the planned path, and the live position.
 */
export function AffectOverlay({
  audible = [],
  emphasis = false,
  highlight,
  labels = [],
  onPath = [],
  options,
  pool = affect,
  position,
  reports = [],
  shape,
  showSounds = true,
  start,
  target,
  trail,
}: AffectOverlayProps) {
  const points = useMemo(() => {
    if (trail) return trail.length > 1 ? toPoints(trail) : null;
    if (!start || !target || !shape) return null;

    // `direct` has no trajectory to draw; show where it lands instead
    if (shape === 'direct') return null;

    return toPoints(
      Array.from({ length: PATH_SAMPLES + 1 }, (_, i) =>
        pathPosition(i / PATH_SAMPLES, start, target, shape, options),
      ),
    );
  }, [trail, start, target, shape, options]);

  // participants' labels always show; a sound label that would collide with
  // one (or with a louder sound's label) is dropped, never stacked
  const soundLabels = useMemo(() => {
    const placed = reports.map(r =>
      labelBox(
        gridX(r.point.valence) + 0.2,
        gridY(r.point.arousal) - 0.15,
        r.label,
      ),
    );

    return labels.flatMap(id => {
      const p = pool[id];

      if (!p) return [];

      const text = getSoundLabel(id);
      const x = gridX(p.valence) + 0.18;
      const y = gridY(p.arousal) + 0.1;
      const box = labelBox(x, y, text);

      if (placed.some(other => overlaps(box, other))) return [];

      placed.push(box);

      return [{ id, text, x, y }];
    });
  }, [labels, reports, pool]);

  return (
    <>
      {showSounds &&
        Object.entries(pool).map(([id, p]) => (
          <circle
            className={
              audible.includes(id)
                ? styles.audible
                : highlight?.has(id)
                  ? styles.highlight
                  : onPath.includes(id)
                    ? styles.onPath
                    : styles.sound
            }
            cx={gridX(p.valence)}
            cy={gridY(p.arousal)}
            key={id}
            r={audible.includes(id) ? 0.13 : 0.08}
          />
        ))}

      {points && (
        <polyline
          className={emphasis ? styles.route : styles.path}
          points={points}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {reports.length > 1 && (
        <polyline
          className={styles.reportLine}
          points={toPoints(reports.map(r => r.point))}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {reports.map((report, i) => (
        <g key={`${report.label}-${i}`}>
          <circle
            className={styles.report}
            cx={gridX(report.point.valence)}
            cy={gridY(report.point.arousal)}
            r={0.13}
            vectorEffect="non-scaling-stroke"
          />
          <text
            className={styles.label}
            x={gridX(report.point.valence) + 0.2}
            y={gridY(report.point.arousal) - 0.15}
          >
            {report.label}
          </text>
        </g>
      ))}

      {start && (
        <circle
          className={styles.start}
          cx={gridX(start.valence)}
          cy={gridY(start.arousal)}
          r={0.22}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {target && (
        <circle
          className={styles.target}
          cx={gridX(target.valence)}
          cy={gridY(target.arousal)}
          r={0.22}
        />
      )}

      {soundLabels.map(label => (
        <text className={styles.label} key={label.id} x={label.x} y={label.y}>
          {label.text}
        </text>
      ))}

      {position && (
        <circle
          className={styles.position}
          cx={gridX(position.valence)}
          cy={gridY(position.arousal)}
          r={0.18}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </>
  );
}
