import { useMemo, useRef, useState } from 'react';
import { IoWarning } from 'react-icons/io5/index';

import {
  AUDIBLE,
  COLUMNS,
  clock,
  sampleAt,
  type Lane,
  type Schedule,
} from '@/lib/route';
import { getSoundLabel } from '@/lib/sounds';
import { cn } from '@/helpers/styles';

import styles from './visualiser.module.css';

export interface Marker {
  label: string;
  t: number;
  title: string;
}

interface TimelineProps {
  /** ids audible at the playhead; their lanes are emphasised */
  live: Set<string>;
  markers?: Array<Marker>;
  onSeek: (t: number) => void;
  schedule: Schedule;
  t: number;
  /** a short library name shown on lanes from added libraries */
  tagOf?: (id: string) => string | null;
}

const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600].map(s => s * 1000);

function ticksFor(duration: number) {
  const step =
    TICK_STEPS.find(s => duration / s <= 10) ?? TICK_STEPS.at(-1) ?? 60_000;
  const ticks: Array<number> = [];

  for (let ms = 0; ms <= duration; ms += step) ticks.push(ms);

  return ticks;
}

/** Step-shaped area and line for one lane, in a 0..COLUMNS × 0..1 box. */
function lanePaths(lane: Lane, peak: number) {
  let area = 'M0,1';
  let line = '';
  let drawing = false;

  lane.columns.forEach((gain, i) => {
    const y = 1 - Math.min(1, gain / peak);

    area += ` L${i},${y} L${i + 1},${y}`;

    if (gain > 0) {
      line += `${drawing ? ' L' : ' M'}${i},${y} L${i + 1},${y}`;
      drawing = true;
    } else {
      drawing = false;
    }
  });

  return { area: `${area} L${COLUMNS},1 Z`, line };
}

const pct = (ms: number, duration: number) =>
  `${Math.min(100, Math.max(0, (ms / duration) * 100))}%`;

/**
 * One lane per sound on a shared time axis: when each sound comes in, how
 * loud it gets, and when it leaves. Click or drag anywhere on the tracks to
 * move the playhead.
 */
export function Timeline({
  live,
  markers = [],
  onSeek,
  schedule,
  t,
  tagOf,
}: TimelineProps) {
  const { duration, lanes } = schedule;
  const peak = Math.max(schedule.peak, 0.01);

  const paths = useMemo(
    () => lanes.map(lane => lanePaths(lane, peak)),
    [lanes, peak],
  );
  const ticks = useMemo(() => ticksFor(duration), [duration]);

  const hitArea = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<{ t: number; y: number } | null>(null);

  const timeAt = (e: React.PointerEvent) => {
    const rect = hitArea.current?.getBoundingClientRect();

    if (!rect) return null;

    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));

    return { t: x * duration, y: e.clientY - rect.top };
  };

  const handleMove = (e: React.PointerEvent) => {
    const at = timeAt(e);

    setHover(at);

    if (at && dragging.current) onSeek(at.t);
  };

  const handleDown = (e: React.PointerEvent) => {
    const at = timeAt(e);

    if (!at) return;

    dragging.current = true;
    hitArea.current?.setPointerCapture(e.pointerId);
    onSeek(at.t);
  };

  const handleUp = (e: React.PointerEvent) => {
    dragging.current = false;
    hitArea.current?.releasePointerCapture(e.pointerId);
  };

  const hovered = useMemo(() => {
    if (!hover) return null;

    const sample = sampleAt(schedule, hover.t);

    return Object.entries(sample?.mix ?? {})
      .filter(([, gain]) => gain > AUDIBLE)
      .sort((a, b) => b[1] - a[1]);
  }, [hover, schedule]);

  if (!lanes.length) {
    return <p className={styles.empty}>Nothing audible on this route.</p>;
  }

  return (
    <div className={styles.timeline}>
      <div className={styles.head}>
        <span className={styles.corner}>Sound</span>
        <div className={styles.axis}>
          {ticks.map(ms => (
            <span
              className={styles.tick}
              key={ms}
              style={{ left: pct(ms, duration) }}
            >
              {clock(ms)}
            </span>
          ))}
          {markers.map(marker => (
            <span
              className={styles.marker}
              key={`${marker.label}-${marker.t}`}
              style={{ left: pct(marker.t, duration) }}
              title={marker.title}
            >
              {marker.label}
            </span>
          ))}
        </div>
      </div>

      <div className={cn(styles.lanes, lanes.length > 60 && styles.dense)}>
        {lanes.map((lane, i) => (
          <div
            className={cn(styles.lane, live.has(lane.id) && styles.live)}
            key={lane.id}
          >
            <div className={styles.name}>
              {tagOf?.(lane.id) && (
                <span className={styles.laneTag}>{tagOf(lane.id)}</span>
              )}
              <span className={styles.laneLabel}>{lane.label}</span>
              <span className={styles.laneSpan}>
                {clock(lane.segments[0].start)}–
                {clock(lane.segments.at(-1)?.end ?? 0)}
              </span>
            </div>
            <div className={styles.track}>
              <svg
                aria-hidden="true"
                preserveAspectRatio="none"
                viewBox={`0 0 ${COLUMNS} 1`}
              >
                <path className={styles.area} d={paths[i].area} />
                <path
                  className={styles.line}
                  d={paths[i].line}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {lane.segments
                .filter(segment => segment.abrupt)
                .map(segment => (
                  <span
                    className={styles.abrupt}
                    key={segment.start}
                    style={{ left: pct(segment.start, duration) }}
                    title={`Abrupt entry at ${clock(segment.start)}: jumps straight in at ${Math.round(segment.entry * 100)}%`}
                  >
                    <IoWarning aria-hidden="true" />
                  </span>
                ))}
            </div>
          </div>
        ))}

        <div
          className={styles.hit}
          ref={hitArea}
          onPointerDown={handleDown}
          onPointerLeave={() => !dragging.current && setHover(null)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        >
          {markers.map(marker => (
            <div
              className={styles.markerLine}
              key={`${marker.label}-${marker.t}`}
              style={{ left: pct(marker.t, duration) }}
            />
          ))}

          <div className={styles.playhead} style={{ left: pct(t, duration) }} />

          {hover && (
            <>
              <div
                className={styles.crosshair}
                style={{ left: pct(hover.t, duration) }}
              />
              <div
                className={cn(
                  styles.tooltip,
                  hover.t > duration * 0.6 && styles.flip,
                )}
                style={{ left: pct(hover.t, duration), top: hover.y }}
              >
                <strong className={styles.tooltipTime}>{clock(hover.t)}</strong>
                {hovered?.length ? (
                  hovered.slice(0, 6).map(([id, gain]) => (
                    <span className={styles.tooltipRow} key={id}>
                      <strong>{Math.round(gain * 100)}%</strong>{' '}
                      {getSoundLabel(id)}
                    </span>
                  ))
                ) : (
                  <span className={styles.tooltipRow}>Silent</span>
                )}
                <span className={styles.tooltipHint}>Click to move here</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
