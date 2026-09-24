/**
 * Affective transition engine.
 *
 * Drives a continuous path through valence/arousal space and renders the
 * position as a sound mix, by modulating per-sound volume.
 *
 * Architectural note: we deliberately do NOT call `useSoundStore.override()`
 * per tick. `override()` runs `unselectAll()` first, which resets every
 * sound's volume to 0.5 and flips `isSelected` off — at tick rate that
 * thrashes Howler play/pause and produces audible dropouts. Instead we select
 * the union of every sound the trajectory will ever touch exactly once, then
 * only change gains from then on. Sounds outside the current neighbourhood
 * sit selected at gain 0 (silent, decoded, ready) so fades in and out are
 * gapless.
 *
 * This module is pure: it knows nothing about React or the stores. The
 * controller in `src/stores/transition.ts` does the selecting, preloading and
 * gain writes.
 */

import {
  affect,
  affectCategory,
  distance,
  type AffectMap,
  type AffectPoint,
} from './affect';

/**
 * - `direct`: the target mix from the start (control; no trajectory)
 * - `drift`:  stays at the target but circles it, changing the mix as much as
 *             `iso` does without heading anywhere (control for change itself)
 * - `linear`: straight line from the reported state to the target
 * - `iso`:    iso-principle; meet the listener's energy, then move
 */
export type PathShape = 'direct' | 'drift' | 'linear' | 'iso';

export interface TransitionOptions {
  /** scene label per sound id for `coherence`; Moodist categories by default */
  categories?: Record<string, string>;
  /**
   * How strongly the mix keeps to one scene. Each sound is weighted by how
   * much its category features in the start and target mixes, blended along
   * the route, so the way from traffic to rain does not pass through the
   * washing machine. A category absent from both ends is weighted by
   * e^-coherence; 0 mixes by mood alone.
   */
  coherence?: number;
  /**
   * A sound beyond the k nearest joins the mix only while it is at least this
   * share as strong as the strongest one. Near-ties (several sounds with the
   * same coordinates) then come in together instead of one being cut
   * arbitrarily, which is heard as a jump. Closer to 1 is closer to a hard k.
   */
  crowd?: number;
  /** fraction of the run spent at the target after arriving (moving shapes) */
  dwell?: number;
  /** rough radius of the figure-eight `drift` traces around the target */
  driftRadius?: number;
  /** number of strongest sounds mixed at any moment, ties aside */
  k?: number;
  /** total mix level, as the gain one sound alone would have (0..1) */
  masterGain?: number;
  /** fraction of the run held before moving: at the start (iso), target (drift) */
  matchHold?: number;
  /**
   * `iso` matches the listener's energy, not their unpleasantness: the matched
   * start never goes below this valence, so a tense listener starts on
   * energetic but neutral sounds rather than sirens. -1 matches both.
   */
  matchValenceFloor?: number;
  /**
   * The sounds the engine may use, keyed by id. Defaults to Moodist's own
   * library; the visualiser swaps in other libraries to compare them.
   */
  pool?: AffectMap;
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
  coherence: 1,
  crowd: 0.8,
  driftRadius: 0.15,
  dwell: 0.2,
  k: 5,
  masterGain: 0.7,
  matchHold: 0.1,
  matchValenceFloor: 0,
  rampIn: 3000,
  sigma: 0.45,
} satisfies Required<Omit<TransitionOptions, 'categories' | 'pool'>>;

export type EngineSettings = typeof ENGINE_DEFAULTS;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How far through its movement a route is at normalised run time t (0..1).
 * `direct` is always there; `linear` moves from the start; `iso` and `drift`
 * hold first. Every moving shape then dwells at the target for `dwell`.
 */
export function progress(
  t: number,
  shape: PathShape,
  options: TransitionOptions = {},
) {
  if (shape === 'direct') return 1;

  const { dwell, matchHold } = { ...ENGINE_DEFAULTS, ...options };
  const from = shape === 'linear' ? 0 : matchHold;
  const to = 1 - dwell;

  if (to <= from) return t >= from ? 1 : 0;

  return clamp01((t - from) / (to - from));
}

/** Where `iso` starts: the reported state, raised to the valence floor. */
export function matchedStart(
  start: AffectPoint,
  options: TransitionOptions = {},
): AffectPoint {
  const { matchValenceFloor } = { ...ENGINE_DEFAULTS, ...options };

  return {
    arousal: start.arousal,
    valence: Math.max(start.valence, matchValenceFloor),
  };
}

/** Distance `iso` travels: an arousal leg, then a valence leg. */
export function isoLength(
  start: AffectPoint,
  target: AffectPoint,
  options: TransitionOptions = {},
) {
  const from = matchedStart(start, options);

  return (
    Math.abs(target.arousal - from.arousal) +
    Math.abs(target.valence - from.valence)
  );
}

/** Length of one loop of the figure-eight x = sin θ, y = sin θ cos θ. */
const LOOP = (() => {
  const steps = 2000;
  let length = 0;

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const b = ((i + 1) / steps) * 2 * Math.PI;
    length += Math.hypot(
      Math.sin(b) - Math.sin(a),
      Math.sin(b) * Math.cos(b) - Math.sin(a) * Math.cos(a),
    );
  }

  return length;
})();

/**
 * Loops and radius for `drift`: whole loops (so it ends back on the target),
 * sized so the total distance matches what `iso` travels between the same
 * points. The radius therefore lands near, not exactly on, `driftRadius`.
 */
export function driftLoops(
  start: AffectPoint,
  target: AffectPoint,
  options: TransitionOptions = {},
) {
  const { driftRadius } = { ...ENGINE_DEFAULTS, ...options };
  const length = isoLength(start, target, options);

  if (!(length > 0) || !(driftRadius > 0)) return { loops: 0, radius: 0 };

  const loops = Math.max(1, Math.round(length / (LOOP * driftRadius)));

  return { loops, radius: length / (loops * LOOP) };
}

/**
 * Where on the path are we at normalised time t (0..1)? `iso` resolves
 * arousal before valence, since ambient sound moves arousal more reliably
 * than valence.
 */
export function pathPosition(
  t: number,
  start: AffectPoint,
  target: AffectPoint,
  shape: PathShape,
  options: TransitionOptions = {},
): AffectPoint {
  const u = progress(clamp01(t), shape, options);

  if (shape === 'direct') return target;

  if (shape === 'drift') {
    const { loops, radius } = driftLoops(start, target, options);
    const angle = 2 * Math.PI * loops * u;

    return {
      arousal: target.arousal + radius * Math.sin(angle) * Math.cos(angle),
      valence: target.valence + radius * Math.sin(angle),
    };
  }

  if (shape === 'linear') {
    return {
      arousal: start.arousal + (target.arousal - start.arousal) * u,
      valence: start.valence + (target.valence - start.valence) * u,
    };
  }

  const from = matchedStart(start, options);
  const arousalLeg = Math.min(1, u / 0.5);
  const valenceLeg = Math.max(0, (u - 0.5) / 0.5);

  return {
    arousal: from.arousal + (target.arousal - from.arousal) * arousalLeg,
    valence: from.valence + (target.valence - from.valence) * valenceLeg,
  };
}

interface MixOptions extends TransitionOptions {
  /** 0..1 per category; sounds are weighted by e^-coherence·(1 - affinity) */
  affinity?: Record<string, number>;
}

function categoryOf(id: string, categories: Record<string, string>) {
  const colon = id.indexOf(':');

  // library sounds without a category count as one scene per library
  return categories[id] ?? (colon === -1 ? 'other' : id.slice(0, colon));
}

/**
 * Render a point in VA space as a set of sound gains.
 *
 * Each sound gets a Gaussian weight by distance (times its scene affinity).
 * The weight of the first sound left out is subtracted from the rest, so a
 * sound enters and leaves the mix at zero instead of jumping in at whatever
 * weight it had when it made the top k. Gains are then normalised to
 * constant power: the mix is as loud in a dense region of the map as in a
 * sparse one, since loudness itself moves arousal.
 */
export function mixAt(
  point: AffectPoint,
  options: MixOptions = {},
): Record<string, number> {
  const { coherence, crowd, k, masterGain, sigma } = {
    ...ENGINE_DEFAULTS,
    ...options,
  };
  const pool = options.pool ?? affect;
  const categories = options.categories ?? affectCategory;
  const { affinity } = options;

  const ids = Object.keys(pool);
  const weights = new Float64Array(ids.length);
  // the k + 1 strongest weights, strongest first. Insertion rather than a
  // sort: pools can run to hundreds of sounds and this runs every tick
  const top: Array<number> = [];

  ids.forEach((id, i) => {
    const d = distance(point, pool[id]);
    let w = Math.exp(-((d / sigma) ** 2));

    if (affinity && coherence > 0) {
      const a = affinity[categoryOf(id, categories)] ?? 0;
      w *= Math.exp(-coherence * (1 - a));
    }

    weights[i] = w;

    if (top.length > k && w <= top[k]) return;

    let j = top.length;
    while (j > 0 && top[j - 1] < w) j--;

    top.splice(j, 0, w);
    if (top.length > k + 1) top.pop();
  });

  const strongest = top[0] ?? 0;
  if (!(strongest > 0)) return {};

  // With fewer than k + 1 sounds nothing is left out. Otherwise the floor is
  // the first sound left out, unless that is within `crowd` of the strongest
  // (a near-tie), in which case every sound above `crowd` shares the mix.
  const floor = Math.min(top[k] ?? 0, crowd * strongest);

  let power = 0;
  const kept: Array<[string, number]> = [];

  ids.forEach((id, i) => {
    const w = weights[i] - floor;

    if (w > 0) {
      kept.push([id, w]);
      power += w * w;
    }
  });

  const norm = Math.sqrt(power);
  const mix: Record<string, number> = {};

  kept.forEach(([id, w]) => {
    mix[id] = (w / norm) * masterGain;
  });

  return mix;
}

/** Share of a mix's power per category, scaled so the largest is 1. */
function palette(
  mix: Record<string, number>,
  categories: Record<string, string>,
) {
  const shares: Record<string, number> = {};
  let largest = 0;

  Object.entries(mix).forEach(([id, gain]) => {
    const category = categoryOf(id, categories);
    shares[category] = (shares[category] ?? 0) + gain * gain;
    largest = Math.max(largest, shares[category]);
  });

  Object.keys(shares).forEach(category => {
    shares[category] /= largest || 1;
  });

  return shares;
}

/** A route without its timing: everything that decides what plays where. */
export interface RouteShape extends TransitionOptions {
  shape: PathShape;
  start: AffectPoint;
  target: AffectPoint;
}

interface Palettes {
  from: Record<string, number>;
  to: Record<string, number>;
}

const palettes = new WeakMap<RouteShape, Palettes>();

/** The start and target scenes, by category, cached per route object. */
function palettesOf(route: RouteShape): Palettes {
  const cached = palettes.get(route);
  if (cached) return cached;

  const categories = route.categories ?? affectCategory;
  const ends = { ...route, coherence: 0 };
  const origin = pathPosition(0, route.start, route.target, route.shape, route);
  const computed = {
    from: palette(mixAt(origin, ends), categories),
    to: palette(mixAt(route.target, ends), categories),
  };

  palettes.set(route, computed);

  return computed;
}

/**
 * Scene affinity per category at progress u: the start scene blended into
 * the target scene. Routes that stay at the target keep the target scene.
 */
function affinityAt(u: number, route: RouteShape) {
  const { coherence } = { ...ENGINE_DEFAULTS, ...route };

  if (!(coherence > 0)) return undefined;

  const { from, to } = palettesOf(route);
  const weight =
    route.shape === 'direct' || route.shape === 'drift' ? 1 : clamp01(u);
  const blended: Record<string, number> = {};
  let largest = 0;

  new Set([...Object.keys(from), ...Object.keys(to)]).forEach(category => {
    const value =
      (1 - weight) * (from[category] ?? 0) + weight * (to[category] ?? 0);
    blended[category] = value;
    largest = Math.max(largest, value);
  });

  Object.keys(blended).forEach(category => {
    blended[category] /= largest || 1;
  });

  return blended;
}

/** Position and mix at normalised run time t, before the ramp-in. */
function renderAt(t: number, route: RouteShape) {
  const u = progress(clamp01(t), route.shape, route);
  const position = pathPosition(
    t,
    route.start,
    route.target,
    route.shape,
    route,
  );
  const mix = mixAt(position, { ...route, affinity: affinityAt(u, route) });

  return { mix, position, progress: u };
}

/**
 * Every sound the trajectory will touch, sampled along the path.
 * Used to pre-select (and therefore preload) before the run starts.
 */
export function trajectorySounds(
  route: RouteShape,
  samples = 600,
): Array<string> {
  const ids = new Set<string>();

  for (let i = 0; i <= samples; i++) {
    Object.keys(renderAt(i / samples, route).mix).forEach(id => {
      ids.add(id);
    });
  }

  return [...ids];
}

/** A complete planned run: where it goes, how, and for how long. */
export interface Route extends RouteShape {
  /** run length in ms */
  duration: number;
}

export interface Frame {
  /** gain for each sound, after the ramp */
  mix: Record<string, number>;
  position: AffectPoint;
  /** how far through its movement the route is, 0..1 */
  progress: number;
  /** normalised time, 0..1 */
  t: number;
}

/**
 * The exact frame the engine renders `ms` into a run. Pure, so a whole run
 * can be planned ahead (the visualiser does this) and match what
 * `runTransition()` actually plays, tick for tick.
 *
 * With `ids`, every one of them gets an entry (0 outside the neighbourhood);
 * without, only the sounds in the mix do.
 */
export function frameAt(ms: number, route: Route, ids?: Array<string>): Frame {
  const { rampIn } = { ...ENGINE_DEFAULTS, ...route };
  const t = route.duration > 0 ? clamp01(ms / route.duration) : 1;
  const ramp = rampIn > 0 ? clamp01(ms / rampIn) : 1;
  const rendered = renderAt(t, route);

  const mix: Record<string, number> = {};
  (ids ?? Object.keys(rendered.mix)).forEach(id => {
    mix[id] = (rendered.mix[id] ?? 0) * ramp;
  });

  return { mix, position: rendered.position, progress: rendered.progress, t };
}

export interface TickState {
  /** ms of run time elapsed, excluding time spent paused */
  elapsed: number;
  /** gain actually written for every sound in the run, after the ramp */
  mix: Record<string, number>;
  position: AffectPoint;
  progress: number;
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
  /** tick rate in Hz — 20Hz keeps per-step gain deltas inaudible */
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

    // every trajectory sound gets an explicit gain every tick; ones outside
    // the current neighbourhood are driven to silence rather than left hanging
    const { mix, position, progress, t } = frameAt(ms, options, ids);

    setVolumes(mix);
    onTick?.({ elapsed: ms, mix, position, progress, t });

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
