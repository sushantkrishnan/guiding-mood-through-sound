/**
 * Route schedules for the visualiser.
 *
 * A schedule is built from a sequence of samples (time, position, mix). The
 * samples come either from planning a route with the engine's own `frameAt()`
 * — so the schedule is exactly what a run will play — or from the trace of a
 * recorded study session, so the same views show what a participant heard.
 */

import { distance, type AffectPoint } from './affect';
import { getSoundLabel } from './sounds';
import type { SessionLog } from './study';
import {
  ENGINE_DEFAULTS,
  frameAt,
  trajectorySounds,
  type Route,
} from './transition';

/** gains at or below this count as silent (full engine gain is 0.7) */
export const AUDIBLE = 0.02;

/**
 * A sound that jumps by at least this much in one step is flagged: the k-nearest
 * cut-off means a sound can enter the mix already fairly loud, which is heard
 * as a sudden onset rather than a fade.
 */
export const ABRUPT = 0.1;

/** columns each lane is reduced to for drawing */
export const COLUMNS = 800;

export interface Sample {
  /** only sounds above zero */
  mix: Record<string, number>;
  position: AffectPoint | null;
  /** ms from the start of the run */
  t: number;
}

export interface Segment {
  abrupt: boolean;
  /** ms the sound fell silent again (or the end of the run) */
  end: number;
  /** gain on the first audible step */
  entry: number;
  peak: number;
  start: number;
}

export interface Lane {
  /** peak gain per drawing column, COLUMNS long */
  columns: Array<number>;
  id: string;
  label: string;
  segments: Array<Segment>;
}

export interface Schedule {
  duration: number;
  lanes: Array<Lane>;
  /** loudest gain anywhere in the schedule, for a shared y scale */
  peak: number;
  samples: Array<Sample>;
}

/** Sample a planned route at the engine's own tick rate. */
export function planSamples(route: Route): Array<Sample> {
  const ids = trajectorySounds(route.start, route.target, route.shape, route);
  // 20Hz like the engine, thinned only for very long routes
  const step = Math.max(50, route.duration / 12_000);
  const samples: Array<Sample> = [];

  for (let ms = 0; ; ms += step) {
    const t = Math.min(ms, route.duration);
    const frame = frameAt(t, route, ids);
    const mix: Record<string, number> = {};

    Object.entries(frame.mix).forEach(([id, gain]) => {
      if (gain > 0) mix[id] = gain;
    });

    samples.push({ mix, position: frame.position, t });

    if (t >= route.duration) break;
  }

  return samples;
}

/** Samples straight from a study session's 20Hz trace. */
export function logSamples(log: SessionLog): Array<Sample> {
  return log.trace.map(row => ({
    mix: row.m,
    position:
      row.v === null || row.a === null
        ? null
        : { arousal: row.a, valence: row.v },
    t: row.t,
  }));
}

export function buildSchedule(
  samples: Array<Sample>,
  duration: number,
  { detectAbrupt = true, rampIn = ENGINE_DEFAULTS.rampIn } = {},
): Schedule {
  const lanes = new Map<string, Lane>();
  const open = new Map<string, Segment>();
  const previous = new Map<string, number>();
  let peak = 0;

  const laneFor = (id: string) => {
    let lane = lanes.get(id);

    if (!lane) {
      lane = {
        columns: new Array(COLUMNS).fill(0),
        id,
        label: getSoundLabel(id),
        segments: [],
      };
      lanes.set(id, lane);
    }

    return lane;
  };

  samples.forEach(sample => {
    const ids = new Set([...open.keys(), ...Object.keys(sample.mix)]);

    ids.forEach(id => {
      const gain = sample.mix[id] ?? 0;
      const before = previous.get(id) ?? 0;
      let segment = open.get(id);

      if (gain > AUDIBLE) {
        if (!segment) {
          segment = {
            abrupt:
              detectAbrupt && sample.t > rampIn && gain - before >= ABRUPT,
            end: sample.t,
            entry: gain,
            peak: gain,
            start: sample.t,
          };
          open.set(id, segment);
          laneFor(id).segments.push(segment);
        }

        segment.end = sample.t;
        segment.peak = Math.max(segment.peak, gain);
        peak = Math.max(peak, gain);

        const lane = laneFor(id);
        const column = Math.min(
          COLUMNS - 1,
          Math.floor((sample.t / duration) * COLUMNS),
        );
        lane.columns[column] = Math.max(lane.columns[column], gain);
      } else if (segment) {
        segment.end = sample.t;
        open.delete(id);
      }

      previous.set(id, gain);
    });
  });

  const ordered = [...lanes.values()].sort(
    (a, b) =>
      a.segments[0].start - b.segments[0].start ||
      a.label.localeCompare(b.label),
  );

  return { duration, lanes: ordered, peak, samples };
}

/** The sample in effect at `t` (the last one at or before it). */
export function sampleAt(schedule: Schedule, t: number): Sample | null {
  const { samples } = schedule;

  if (!samples.length) return null;

  let lo = 0;
  let hi = samples.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }

  return samples[lo];
}

export interface Playing {
  gain: number;
  lane: Lane;
  segment: Segment;
}

/** Sounds audible at `t`, loudest first. */
export function nowPlaying(schedule: Schedule, t: number): Array<Playing> {
  const sample = sampleAt(schedule, t);
  const playing: Array<Playing> = [];

  schedule.lanes.forEach(lane => {
    const segment = lane.segments.find(s => s.start <= t && t <= s.end);
    const gain = sample?.mix[lane.id] ?? 0;

    if (segment && gain > AUDIBLE) playing.push({ gain, lane, segment });
  });

  return playing.sort((a, b) => b.gain - a.gain);
}

/** Sound entries still to come after `t`, soonest first. */
export function upNext(schedule: Schedule, t: number, limit = 6) {
  return schedule.lanes
    .flatMap(lane =>
      lane.segments
        .filter(segment => segment.start > t)
        .map(segment => ({ lane, segment })),
    )
    .sort((a, b) => a.segment.start - b.segment.start)
    .slice(0, limit);
}

export interface RouteStats {
  abrupt: number;
  /** ms at which the position first comes within `radius` of the target */
  arrivesAt: number | null;
  sounds: number;
  /** ms spent within `radius` of the target */
  targetExposure: number;
}

export function routeStats(
  schedule: Schedule,
  target: AffectPoint | null,
  radius = 0.1,
): RouteStats {
  let arrivesAt: number | null = null;
  let targetExposure = 0;
  const { samples } = schedule;

  if (target) {
    samples.forEach((sample, i) => {
      if (!sample.position || distance(sample.position, target) > radius)
        return;

      if (arrivesAt === null) arrivesAt = sample.t;
      if (i + 1 < samples.length) targetExposure += samples[i + 1].t - sample.t;
    });
  }

  return {
    abrupt: schedule.lanes.reduce(
      (n, lane) => n + lane.segments.filter(s => s.abrupt).length,
      0,
    ),
    arrivesAt,
    sounds: schedule.lanes.length,
    targetExposure,
  };
}

/** m:ss */
export function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60);

  return `${m}:${String(s).padStart(2, '0')}`;
}
