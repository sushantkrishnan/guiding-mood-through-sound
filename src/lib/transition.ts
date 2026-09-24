/**
 * Affective transition engine.
 *
 * Drives a continuous path through valence/arousal space and renders the
 * position as a sound mix, by modulating per-sound volume in the sound store.
 *
 * Architectural note: we deliberately do NOT call `useSoundStore.override()`
 * per tick. `override()` runs `unselectAll()` first, which resets every
 * sound's volume to 0.5 and flips `isSelected` off — at tick rate that
 * thrashes Howler play/pause and produces audible dropouts. Instead we select
 * the union of every sound the trajectory will ever touch exactly once, then
 * only mutate volume from then on. Sounds outside the current neighbourhood
 * sit selected at volume 0 (silent, decoded, ready) so fades in and out are
 * gapless.
 *
 * This module is pure: it knows nothing about React or the stores. The
 * controller in `src/stores/transition.ts` does the selecting, preloading and
 * store writes.
 */

import { affect, distance, type AffectMap, type AffectPoint } from './affect';

export type PathShape = 'direct' | 'linear' | 'iso';

export interface TransitionOptions {
  /** number of nearest sounds mixed at any moment */
  k?: number;
  /** master gain applied to the whole mix (0..1) */
  masterGain?: number;
  /**
   * The sounds the engine may use, keyed by id. Defaults to Moodist's own
   * library; the visualiser swaps in other libraries to compare them.
   */
  pool?: AffectMap;
  /** fraction of the run spent holding at the start point, `iso` only */
  matchHold?: number;
  /**
   * ms over which the whole mix fades up from silence at the start of a run.
   * Applied identically to every path shape so it cannot confound them; it
   * exists so `direct` does not start with an abrupt full-gain onset.
   */
  rampIn?: number;
  /** kernel width — larger blends more sounds, smaller is more selective */
  sigma?: number;
}

export const ENGINE_DEFAULTS = {
  k: 5,
  masterGain: 0.7,
  matchHold: 0.25,
  rampIn: 3000,
  sigma: 0.45,
} satisfies Required<Omit<TransitionOptions, 'pool'>>;

/**
 * Where on the path are we at normalised time t (0..1)?
 *
 * - `direct`: jump straight to target (control condition — no trajectory)
 * - `linear`: straight-line interpolation through VA space
 * - `iso`:    iso-principle. Hold at the participant's reported current state,
 *             then move. Arousal is resolved before valence, since ambient
 *             sound manipulates arousal more reliably than valence.
 */
export function pathPosition(
  t: number,
  start: AffectPoint,
  target: AffectPoint,
  shape: PathShape,
  options: TransitionOptions = {},
): AffectPoint {
  const { matchHold } = { ...ENGINE_DEFAULTS, ...options };
  const clamped = Math.min(1, Math.max(0, t));

  if (shape === 'direct') return target;

  if (shape === 'linear') {
    return {
      arousal: start.arousal + (target.arousal - start.arousal) * clamped,
      valence: start.valence + (target.valence - start.valence) * clamped,
    };
  }

  // iso: hold, then arousal leg, then valence leg
  if (clamped < matchHold) return start;

  const moved = (clamped - matchHold) / (1 - matchHold);
  const arousalLeg = Math.min(1, moved / 0.5);
  const valenceLeg = Math.max(0, (moved - 0.5) / 0.5);

  return {
    arousal: start.arousal + (target.arousal - start.arousal) * arousalLeg,
    valence: start.valence + (target.valence - start.valence) * valenceLeg,
  };
}

/**
 * Render a point in VA space as a set of sound gains.
 * Gaussian kernel over the k nearest sounds, normalised so the closest sound
 * always sits at full master gain regardless of how sparse the region is.
 */
export function mixAt(
  point: AffectPoint,
  options: TransitionOptions = {},
): Record<string, number> {
  const { k, masterGain, sigma } = { ...ENGINE_DEFAULTS, ...options };
  const pool = options.pool ?? affect;

  // k nearest by insertion rather than sorting the whole pool: pools can run
  // to hundreds of sounds and this runs every tick. Equal distances keep pool
  // order, exactly as the stable sort this replaces did.
  const ranked: Array<{ d: number; id: string }> = [];

  for (const id of Object.keys(pool)) {
    const d = distance(point, pool[id]);

    if (ranked.length === k && d >= ranked[k - 1].d) continue;

    let i = ranked.length;
    while (i > 0 && ranked[i - 1].d > d) i--;

    ranked.splice(i, 0, { d, id });
    if (ranked.length > k) ranked.pop();
  }

  const weights = ranked.map(r => Math.exp(-((r.d / sigma) ** 2)));
  const peak = Math.max(...weights, 1e-6);

  const mix: Record<string, number> = {};

  ranked.forEach((r, i) => {
    mix[r.id] = (weights[i] / peak) * masterGain;
  });

  return mix;
}

/**
 * Every sound the trajectory will touch, sampled along the path.
 * Used to pre-select (and therefore preload) before the run starts.
 */
export function trajectorySounds(
  start: AffectPoint,
  target: AffectPoint,
  shape: PathShape,
  options: TransitionOptions = {},
  samples = 40,
): Array<string> {
  const ids = new Set<string>();

  for (let i = 0; i <= samples; i++) {
    const point = pathPosition(i / samples, start, target, shape, options);
    Object.keys(mixAt(point, options)).forEach(id => {
      ids.add(id);
    });
  }

  return [...ids];
}

/** A complete planned run: where it goes, how, and for how long. */
export interface Route extends TransitionOptions {
  /** run length in ms */
  duration: number;
  shape: PathShape;
  start: AffectPoint;
  target: AffectPoint;
}

export interface Frame {
  /** gain for each sound, after the ramp */
  mix: Record<string, number>;
  position: AffectPoint;
  /** normalised time, 0..1 */
  t: number;
}

/**
 * The exact frame the engine renders `ms` into a run. Pure, so a whole run
 * can be planned ahead (the visualiser does this) and match what
 * `runTransition()` actually plays, tick for tick.
 *
 * With `ids`, every one of them gets an entry (0 outside the neighbourhood);
 * without, only the k nearest sounds do.
 */
export function frameAt(ms: number, route: Route, ids?: Array<string>): Frame {
  const { rampIn } = { ...ENGINE_DEFAULTS, ...route };
  const t =
    route.duration > 0 ? Math.min(1, Math.max(0, ms / route.duration)) : 1;
  const position = pathPosition(
    t,
    route.start,
    route.target,
    route.shape,
    route,
  );
  const ramp = rampIn > 0 ? Math.min(1, Math.max(0, ms / rampIn)) : 1;
  const neighbourhood = mixAt(position, route);

  const mix: Record<string, number> = {};
  (ids ?? Object.keys(neighbourhood)).forEach(id => {
    mix[id] = (neighbourhood[id] ?? 0) * ramp;
  });

  return { mix, position, t };
}

export interface TickState {
  /** ms of run time elapsed, excluding time spent paused */
  elapsed: number;
  /** gain actually written for every sound in the run, after the ramp */
  mix: Record<string, number>;
  position: AffectPoint;
  t: number;
}

export interface EngineHandle {
  cancel: () => void;
  pause: () => void;
  resume: () => void;
}

export interface RunOptions extends Route {
  /**
   * Every sound the run may touch, from `trajectorySounds()`. The caller must
   * already have selected (and ideally preloaded) these.
   */
  ids: Array<string>;
  onComplete?: () => void;
  onTick?: (state: TickState) => void;
  /** receives a gain for every id on every tick, 0 outside the neighbourhood */
  setVolumes: (volumes: Record<string, number>) => void;
  /** store tick rate in Hz — 20Hz keeps per-step gain deltas inaudible */
  tickRate?: number;
}

/**
 * Run a transition. Returns a handle so the caller can pause or abort.
 *
 * Timing comes from performance.now() rather than accumulated tick counts, so
 * a throttled background tab resumes at the correct point on the path instead
 * of drifting. Paused time is excluded, so a paused run still plays for its
 * full duration.
 */
export function runTransition(options: RunOptions): EngineHandle {
  const { ids, onComplete, onTick, setVolumes, tickRate = 20 } = options;

  let banked = 0;
  let resumedAt: number | null = performance.now();
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const elapsed = () =>
    banked + (resumedAt === null ? 0 : performance.now() - resumedAt);

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const stop = () => {
    cancelled = true;
    clear();
  };

  const tick = () => {
    if (cancelled) return;

    const ms = elapsed();

    // every trajectory sound gets an explicit volume every tick; ones outside
    // the current neighbourhood are driven to silence rather than left hanging
    const { mix, position, t } = frameAt(ms, options, ids);

    setVolumes(mix);
    onTick?.({ elapsed: ms, mix, position, t });

    if (t >= 1) {
      stop();
      onComplete?.();
    }
  };

  const schedule = () => {
    clear();
    tick();
    if (!cancelled) timer = setInterval(tick, 1000 / tickRate);
  };

  schedule();

  return {
    cancel: stop,
    pause() {
      if (cancelled || resumedAt === null) return;
      banked = elapsed();
      resumedAt = null;
      clear();
    },
    resume() {
      if (cancelled || resumedAt !== null) return;
      resumedAt = performance.now();
      schedule();
    },
  };
}
