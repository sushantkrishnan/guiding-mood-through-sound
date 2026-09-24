/**
 * Study harness: conditions, counterbalancing, the session log format, and
 * export.
 *
 * Everything the harness records for one participant-session ends up in a
 * single `SessionLog`, downloaded as JSON when the session ends and backed up
 * in the browser (log-store.ts).
 */

import {
  affect,
  cellToPoint,
  distance,
  type AffectMap,
  type AffectPoint,
  type GridCell,
} from './affect';
import { buildInfo, mapHash, type BuildInfo } from './provenance';
import {
  ENGINE_DEFAULTS,
  type Drift,
  type EngineSettings,
  type PathShape,
} from './transition';

export const LOG_SCHEMA = 'moodist-study/2';

/** Logs this version can open (the visualiser and analysis read both). */
export const LOG_SCHEMAS = ['moodist-study/1', LOG_SCHEMA];

/**
 * `unguided` is the self-selected arm from Lowe-Brown et al. (2026): the
 * participant mixes freely in the normal Moodist UI towards their target.
 */
export type Condition = PathShape | 'unguided';

/**
 * Conditions a participant session can use, in canonical order; a Latin
 * square is built over the enabled subset. `linear` is left out on purpose:
 * it differs from `iso` only in a parameter, and a pilot this size cannot
 * afford an arm for it. It stays in the visualiser.
 */
export const CONDITIONS: Array<{ hint: string; id: Condition; label: string }> =
  [
    { hint: 'the manipulation', id: 'iso', label: 'Guided (iso-principle)' },
    {
      hint: 'target mix from the start',
      id: 'direct',
      label: 'Direct target (control)',
    },
    {
      hint: 'as much change as guided, but no direction',
      id: 'drift',
      label: 'Direct + drift (control)',
    },
    {
      hint: 'participant mixes themselves',
      id: 'unguided',
      label: 'Unguided (self-mixed)',
    },
  ];

const LABELS: Record<Condition, string> = {
  direct: 'Direct target',
  drift: 'Direct + drift',
  iso: 'Guided (iso)',
  linear: 'Linear',
  unguided: 'Unguided',
};

export const conditionLabel = (id: Condition) => LABELS[id] ?? id;

/**
 * Williams-design balanced Latin square: every condition appears in every
 * position, and every condition follows every other equally often. An odd
 * number of conditions needs the square plus its mirror (2n sequences).
 */
export function williams<T>(conditions: Array<T>): Array<Array<T>> {
  const n = conditions.length;
  const first: Array<number> = [];

  for (let i = 0, lo = 1, hi = n - 1; i < n; i++) {
    if (i === 0) first.push(0);
    else if (i % 2 === 1) first.push(lo++);
    else first.push(hi--);
  }

  const rows = first.map((_, r) => first.map(c => (c + r) % n));
  const all = n % 2 ? [...rows, ...rows.map(row => [...row].reverse())] : rows;

  return all.map(row => row.map(i => conditions[i]));
}

/** Condition order for a participant, numbered from 1. */
export function orderFor<T>(participant: number, conditions: Array<T>) {
  const rows = williams(conditions);

  return rows[(Math.max(1, participant) - 1) % rows.length];
}

/** How many sequences a full counterbalance needs: recruit in multiples. */
export const sequencesFor = (conditions: number) =>
  conditions % 2 ? conditions * 2 : conditions;

/**
 * - `phases`: halfway through the movement and on arrival, at the same
 *   times in every condition. Two interruptions instead of four.
 * - `interval`: every `probeInterval` minutes.
 */
export type CheckIns = 'none' | 'phases' | 'interval';

/**
 * Where a session's target comes from.
 * - `choose`: the participant picks it
 * - `first`: the one this participant picked in their first session, so
 *   every session of theirs travels to the same place (picks it in session 1)
 * - `fixed`: set by the researcher, e.g. to test calming down only
 */
export type TargetMode = 'choose' | 'first' | 'fixed';

export interface StudySetup {
  checkIns: CheckIns;
  /** a soft chime when a check-in appears, for eyes-closed listening */
  chime: boolean;
  conditions: Array<Condition>;
  /** the researcher's note of the headphones and device, for the log */
  device: string;
  /** listening time per session, minutes */
  duration: number;
  /** map the grid onto the region the sounds actually cover */
  fitToMap: boolean;
  /** the target when `targetMode` is `fixed` */
  fixedTarget: GridCell;
  /** start and target closer than this (in cells) are flagged in the log */
  minDistance: number;
  /** after listening, draw how pleasant and energised they felt over time */
  moodCurve: boolean;
  participantId: string;
  /** drives counterbalancing, 1-based */
  participantNumber: number;
  /** minutes between check-ins when `checkIns` is `interval` */
  probeInterval: number;
  /** rate the sounds they heard, at the end of the final session */
  ratingBlock: boolean;
  /** at most this many sounds in the rating block */
  ratingCount: number;
  /** seconds each sound plays before it can be rated */
  ratingSeconds: number;
  /** 1-based index into this participant's condition order */
  session: number;
  /** global volume set at the start of listening, 0..1 */
  startVolume: number;
  targetMode: TargetMode;
}

export const DEFAULT_SETUP: StudySetup = {
  checkIns: 'phases',
  chime: true,
  conditions: ['iso', 'direct'],
  device: '',
  duration: 10,
  fitToMap: true,
  fixedTarget: { arousal: 3, pleasure: 7 },
  minDistance: 2,
  moodCurve: true,
  participantId: '',
  participantNumber: 1,
  probeInterval: 2,
  ratingBlock: true,
  ratingCount: 20,
  ratingSeconds: 10,
  session: 1,
  startVolume: 0.8,
  targetMode: 'first',
};

/** When check-ins fall due, in listening ms. */
export function probeTimes(
  setup: Pick<StudySetup, 'checkIns' | 'duration' | 'probeInterval'>,
  engine: Pick<EngineSettings, 'dwell' | 'matchHold'> = ENGINE_DEFAULTS,
): Array<number> {
  const duration = setup.duration * 60_000;

  if (setup.checkIns === 'none') return [];

  if (setup.checkIns === 'phases') {
    // guided routes move between the hold and the dwell; the same moments
    // are used for every condition, so they are compared like for like
    const arrive = 1 - engine.dwell;
    const halfway = (engine.matchHold + arrive) / 2;

    return [halfway, arrive]
      .filter(f => f > 0 && f < 1)
      .map(f => Math.round(f * duration));
  }

  const times: Array<number> = [];
  const step = setup.probeInterval * 60_000;

  if (step > 0) {
    for (let due = step; due < duration; due += step) times.push(due);
  }

  return times;
}

export interface GridAnswer {
  arousal: number;
  /** raw Affect Grid scores, 1..9 */
  grid: GridCell;
  valence: number;
}

export const toAnswer = (cell: GridCell): GridAnswer => ({
  grid: cell,
  ...cellToPoint(cell),
});

export interface ProbeRecord {
  /** listening ms the participant answered at, or null if never answered */
  answeredMs: number | null;
  answer: GridAnswer | null;
  /** listening ms the probe was scheduled for */
  dueMs: number;
  index: number;
  /** listening ms the probe appeared at, or null if it was skipped */
  shownMs: number | null;
}

/** Retrospective mood curve: 1..9 at evenly spaced moments, start to end. */
export interface MoodCurve {
  energy: Array<number>;
  pleasantness: Array<number>;
}

export interface SoundRating {
  answer: GridAnswer;
  /** session ms the rating was given */
  answeredMs: number;
  id: string;
  /** position in this participant's (shuffled) rating order */
  index: number;
  /** session ms the sound started playing */
  shownMs: number;
}

export interface Questionnaire {
  coherence: number | null;
  comments: string;
  direction: number | null;
  effectiveness: number | null;
  monotony: number | null;
  pleasantness: number | null;
  /** final session only: the preferred session number, 0 = no preference */
  preferredSession: number | null;
  preferenceReason: string;
  wrongMoment: boolean | null;
  wrongMomentDetail: string;
}

export interface TraceRow {
  /** arousal of the rendered position (engine), or of the mix centroid (unguided) */
  a: number | null;
  /** audible gains, only sounds above zero, rounded to 3dp */
  m: Record<string, number>;
  /** listening ms, excluding pauses */
  t: number;
  v: number | null;
}

export interface StudyEvent {
  [key: string]: unknown;
  /** wall-clock ms since the researcher started the session */
  t: number;
  type: string;
}

export type TargetSource = 'participant' | 'first-session' | 'fixed';

export interface SessionRoute {
  /** drift only: its calibration against iso (see driftLoops) */
  drift?: Drift;
  /** the grid answers the route was built from */
  from: GridAnswer;
  shape: Condition;
  /** engine-space points actually used, after fitting to the map */
  start: AffectPoint;
  target: AffectPoint;
  to: GridAnswer;
  toSource: TargetSource;
}

export interface SessionLog {
  build: BuildInfo;
  condition: Condition;
  config: {
    durationMs: number;
    engine: EngineSettings;
    fitToMap: boolean;
    /** the affect map the session used (see provenance.ts) */
    map: { hash: string; sounds: number };
    /** listening ms each check-in fell due */
    probeTimesMs: Array<number>;
    tickRate: number;
    /** trace rows per second; guided runs replay exactly from `route` */
    traceRate: number;
  };
  endedAt: string | null;
  events: Array<StudyEvent>;
  flags: {
    /** start and target fewer than `setup.minDistance` cells apart */
    closeStartTarget: boolean;
    /** ms since this participant's previous session ended, if saved here */
    sincePreviousMs: number | null;
    /**
     * Distance between the target the route aimed for and the centre of the
     * mix actually played there. Large where the map is sparse.
     */
    targetGap: number | null;
  };
  measures: {
    curve: MoodCurve | null;
    post: GridAnswer | null;
    pre: GridAnswer | null;
    probes: Array<ProbeRecord>;
    questionnaire: Questionnaire | null;
    ratings: Array<SoundRating>;
    /** the participant's own target answer; null when it was set for them */
    target: GridAnswer | null;
  };
  order: Array<Condition>;
  participantId: string;
  participantNumber: number;
  route: SessionRoute | null;
  schema: typeof LOG_SCHEMA;
  session: number;
  setup: StudySetup;
  startedAt: string;
  /** local wall-clock start with its UTC offset, e.g. 2026-09-25 14:05 +12:00 */
  startedLocal: string;
  summary: {
    completed: boolean;
    /** listening ms at which the participant ended early, if they did */
    exitedEarlyMs: number | null;
    listenedMs: number;
    /** unguided: selections and volume changes made in the mixer */
    mixerChanges: number;
    /** sounds still loading when the clock started */
    missingSounds: Array<string>;
    pauses: number;
    /** ms the rendered position spent within TARGET_RADIUS of the target */
    targetExposureMs: number;
    targetRadius: number;
    volumeChanges: number;
  };
  trace: Array<TraceRow>;
  userAgent: string;
}

export const TARGET_RADIUS = 0.1;

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Local time with its UTC offset, for time-of-day analysis. */
export function localStamp(date = new Date()) {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} ${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

/** Gain-weighted centroid of a mix in affect space, or null if silent. */
export function centroid(
  mix: Record<string, number>,
  pool: AffectMap = affect,
): AffectPoint | null {
  let total = 0;
  let arousal = 0;
  let valence = 0;

  Object.entries(mix).forEach(([id, gain]) => {
    const point = pool[id];

    if (!point || gain <= 0) return;

    total += gain;
    arousal += point.arousal * gain;
    valence += point.valence * gain;
  });

  return total ? { arousal: arousal / total, valence: valence / total } : null;
}

export function traceRow(
  t: number,
  position: AffectPoint | null,
  mix: Record<string, number>,
): TraceRow {
  const m: Record<string, number> = {};

  Object.entries(mix).forEach(([id, gain]) => {
    if (gain > 0) m[id] = round(gain);
  });

  return {
    a: position ? round(position.arousal) : null,
    m,
    t: Math.round(t),
    v: position ? round(position.valence) : null,
  };
}

/** Cumulative ms the trace spent within `radius` of the target. */
export function targetExposure(
  trace: Array<TraceRow>,
  target: AffectPoint,
  radius = TARGET_RADIUS,
) {
  let ms = 0;

  for (let i = 1; i < trace.length; i++) {
    const row = trace[i - 1];

    if (row.v === null || row.a === null) continue;

    const d = distance({ arousal: row.a, valence: row.v }, target);

    if (d <= radius) ms += trace[i].t - row.t;
  }

  return ms;
}

export function createLog(setup: StudySetup, order: Array<Condition>) {
  const now = new Date();
  const log: SessionLog = {
    build: buildInfo(),
    condition: order[setup.session - 1],
    config: {
      durationMs: setup.duration * 60_000,
      engine: { ...ENGINE_DEFAULTS },
      fitToMap: setup.fitToMap,
      map: { hash: mapHash(affect), sounds: Object.keys(affect).length },
      probeTimesMs: probeTimes(setup),
      tickRate: 20,
      traceRate: 2,
    },
    endedAt: null,
    events: [],
    flags: { closeStartTarget: false, sincePreviousMs: null, targetGap: null },
    measures: {
      curve: null,
      post: null,
      pre: null,
      probes: [],
      questionnaire: null,
      ratings: [],
      target: null,
    },
    order,
    participantId: setup.participantId,
    participantNumber: setup.participantNumber,
    route: null,
    schema: LOG_SCHEMA,
    session: setup.session,
    setup: { ...setup },
    startedAt: now.toISOString(),
    startedLocal: localStamp(now),
    summary: {
      completed: false,
      exitedEarlyMs: null,
      listenedMs: 0,
      mixerChanges: 0,
      missingSounds: [],
      pauses: 0,
      targetExposureMs: 0,
      targetRadius: TARGET_RADIUS,
      volumeChanges: 0,
    },
    trace: [],
    userAgent: navigator.userAgent,
  };

  return log;
}

/**
 * The target this participant chose in their earliest session saved here,
 * for `targetMode: 'first'`. Reads v1 logs too.
 */
export function firstTarget(
  logs: Array<SessionLog>,
  participantId: string,
): GridCell | null {
  const earliest = logs
    .filter(log => log.participantId === participantId)
    .map(log => ({
      cell: log.route?.to.grid ?? log.measures.target?.grid ?? null,
      session: log.session,
    }))
    .filter(entry => entry.cell !== null)
    .sort((a, b) => a.session - b.session)[0];

  return earliest?.cell ?? null;
}

/** ms since this participant's most recent other session ended. */
export function sincePrevious(
  logs: Array<SessionLog>,
  participantId: string,
  session: number,
  now = Date.now(),
) {
  const ended = logs
    .filter(
      log =>
        log.participantId === participantId &&
        log.session !== session &&
        log.endedAt,
    )
    .map(log => Date.parse(log.endedAt as string))
    .filter(t => Number.isFinite(t) && t <= now);

  return ended.length ? now - Math.max(...ended) : null;
}

/** Small seeded PRNG (mulberry32), so a participant's order is reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sounds to rate at the end: the ones this participant actually heard
 * across their sessions, most airtime first (gain × time), capped at
 * `count`, then shuffled with a seed so the order is reproducible.
 */
export function ratingSounds(
  logs: Array<SessionLog>,
  count: number,
  seed: number,
  isRatable: (id: string) => boolean = id => id in affect,
) {
  const airtime: Record<string, number> = {};

  logs.forEach(log => {
    log.trace.forEach((row, i) => {
      const next = log.trace[i + 1];
      const dt = next ? next.t - row.t : 0;

      Object.entries(row.m).forEach(([id, gain]) => {
        if (gain > 0.02 && isRatable(id)) {
          airtime[id] = (airtime[id] ?? 0) + gain * Math.max(dt, 1);
        }
      });
    });
  });

  const chosen = Object.keys(airtime)
    .sort((a, b) => airtime[b] - airtime[a] || a.localeCompare(b))
    .slice(0, Math.max(0, count));

  const random = seeded(seed);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }

  return chosen;
}

export function logFilename(
  log: Pick<SessionLog, 'participantId' | 'session'>,
) {
  const id = log.participantId.replace(/[^\w-]+/g, '_');

  // condition deliberately left out: the name is visible on screen
  return `moodist-${id}-s${log.session}.json`;
}

export function downloadLog(log: SessionLog) {
  const blob = new Blob([JSON.stringify(log)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = logFilename(log);
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
