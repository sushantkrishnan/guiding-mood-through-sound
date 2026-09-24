/**
 * Study harness: condition assignment, the session log format, and export.
 *
 * Everything the harness records for one participant-session ends up in a
 * single `SessionLog`, downloaded as JSON when the session ends and also kept
 * in localStorage as a best-effort backup.
 */

import { affect, distance, type AffectPoint } from './affect';
import { ENGINE_DEFAULTS, type PathShape } from './transition';

export const LOG_SCHEMA = 'moodist-study/1';

/**
 * `unguided` is the self-selected arm from Lowe-Brown et al. (2026): the
 * participant mixes freely in the normal Moodist UI towards their target.
 */
export type Condition = PathShape | 'unguided';

/** Canonical order; a Latin square is built over the enabled subset of this. */
export const CONDITIONS: Array<{ id: Condition; label: string }> = [
  { id: 'iso', label: 'Guided (iso-principle)' },
  { id: 'direct', label: 'Direct target (control)' },
  { id: 'linear', label: 'Linear' },
  { id: 'unguided', label: 'Unguided (self-mixed)' },
];

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

export interface StudySetup {
  conditions: Array<Condition>;
  /** listening time per session, minutes */
  duration: number;
  participantId: string;
  /** drives counterbalancing, 1-based */
  participantNumber: number;
  /** minutes between in-session Affect Grid probes */
  probeInterval: number;
  /** 1-based index into this participant's condition order */
  session: number;
}

export interface GridAnswer {
  arousal: number;
  /** raw Affect Grid scores, 1..9 */
  grid: { arousal: number; pleasure: number };
  valence: number;
}

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

export interface Questionnaire {
  coherence: number | null;
  comments: string;
  direction: number | null;
  effectiveness: number | null;
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

export interface SessionLog {
  condition: Condition;
  config: {
    durationMs: number;
    engine: typeof ENGINE_DEFAULTS;
    probeIntervalMs: number;
    tickRate: number;
  };
  endedAt: string | null;
  events: Array<StudyEvent>;
  measures: {
    post: GridAnswer | null;
    pre: GridAnswer | null;
    probes: Array<ProbeRecord>;
    questionnaire: Questionnaire | null;
    target: GridAnswer | null;
  };
  order: Array<Condition>;
  participantId: string;
  participantNumber: number;
  schema: typeof LOG_SCHEMA;
  session: number;
  startedAt: string;
  summary: {
    completed: boolean;
    /** listening ms at which the participant ended early, if they did */
    exitedEarlyMs: number | null;
    listenedMs: number;
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

/** Gain-weighted centroid of a mix in affect space, or null if silent. */
export function centroid(mix: Record<string, number>): AffectPoint | null {
  let total = 0;
  let arousal = 0;
  let valence = 0;

  Object.entries(mix).forEach(([id, gain]) => {
    const point = affect[id];

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
  const log: SessionLog = {
    condition: order[setup.session - 1],
    config: {
      durationMs: setup.duration * 60_000,
      engine: { ...ENGINE_DEFAULTS },
      probeIntervalMs: setup.probeInterval * 60_000,
      tickRate: 20,
    },
    endedAt: null,
    events: [],
    measures: {
      post: null,
      pre: null,
      probes: [],
      questionnaire: null,
      target: null,
    },
    order,
    participantId: setup.participantId,
    participantNumber: setup.participantNumber,
    schema: LOG_SCHEMA,
    session: setup.session,
    startedAt: new Date().toISOString(),
    summary: {
      completed: false,
      exitedEarlyMs: null,
      listenedMs: 0,
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

export function logFilename(log: SessionLog) {
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

const STORAGE_KEY = 'moodist-study-logs';

export function savedLogs(): Array<SessionLog> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Best-effort backup. Returns false if storage is full or unavailable. */
export function saveLog(log: SessionLog) {
  try {
    const logs = savedLogs().filter(
      l =>
        !(l.participantId === log.participantId && l.session === log.session),
    );

    localStorage.setItem(STORAGE_KEY, JSON.stringify([...logs, log]));

    return true;
  } catch {
    return false;
  }
}

export function clearLogs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
