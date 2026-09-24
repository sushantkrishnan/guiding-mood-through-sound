import { afterEach, describe, expect, it, vi } from 'vitest';

import { affect, cellToPoint, distance, fitToPool } from './affect';
import { buildSchedule, planSamples } from './route';
import {
  ENGINE_DEFAULTS,
  driftLoops,
  frameAt,
  isoLength,
  matchedStart,
  mixAt,
  pathPosition,
  progress,
  runTransition,
  trajectorySounds,
  type PathShape,
  type Route,
} from './transition';

const tense = fitToPool(cellToPoint({ arousal: 8, pleasure: 2 }));
const calm = fitToPool(cellToPoint({ arousal: 2, pleasure: 8 }));
const shapes: Array<PathShape> = ['iso', 'linear', 'drift', 'direct'];

const power = (mix: Record<string, number>) =>
  Math.sqrt(Object.values(mix).reduce((sum, g) => sum + g * g, 0));

describe('progress', () => {
  it('holds, moves, then dwells', () => {
    const { dwell, matchHold } = ENGINE_DEFAULTS;

    expect(progress(0.5, 'direct')).toBe(1);
    expect(progress(matchHold / 2, 'iso')).toBe(0);
    expect(progress(0, 'linear')).toBe(0);
    expect(progress(1 - dwell, 'iso')).toBe(1);
    expect(progress(1 - dwell / 2, 'linear')).toBe(1);
    expect(progress((matchHold + 1 - dwell) / 2, 'iso')).toBeCloseTo(0.5);
  });
});

describe('pathPosition', () => {
  it('ends on the target for every shape', () => {
    shapes.forEach(shape => {
      const end = pathPosition(1, tense, calm, shape);
      expect(distance(end, calm)).toBeLessThan(1e-9);
    });
  });

  it('starts iso on the energy match, not the unpleasantness', () => {
    const start = pathPosition(0, tense, calm, 'iso');

    expect(start.arousal).toBeCloseTo(tense.arousal);
    expect(start.valence).toBe(ENGINE_DEFAULTS.matchValenceFloor);
    expect(matchedStart(tense, { matchValenceFloor: -1 })).toEqual(tense);
  });

  it('keeps drift near the target and matches iso path length', () => {
    const steps = 20_000;
    let length = 0;
    let furthest = 0;
    let previous = pathPosition(0, tense, calm, 'drift');

    for (let i = 1; i <= steps; i++) {
      const point = pathPosition(i / steps, tense, calm, 'drift');
      length += distance(point, previous);
      furthest = Math.max(furthest, distance(point, calm));
      previous = point;
    }

    const { radius } = driftLoops(tense, calm);
    expect(length).toBeCloseTo(isoLength(tense, calm), 2);
    expect(furthest).toBeLessThanOrEqual(radius + 1e-9);
    expect(radius).toBeLessThan(ENGINE_DEFAULTS.driftRadius * 1.5);
  });
});

describe('mixAt', () => {
  it('keeps the mix at constant power everywhere on the map', () => {
    for (let a = -1; a <= 1; a += 0.25) {
      for (let v = -1; v <= 1; v += 0.25) {
        const mix = mixAt({ arousal: a, valence: v });
        expect(power(mix)).toBeCloseTo(ENGINE_DEFAULTS.masterGain, 9);
      }
    }
  });

  it('never mixes more than k sounds unless they tie', () => {
    const pool = {
      a: { arousal: 0, valence: 0 },
      b: { arousal: 0, valence: 0.3 },
      c: { arousal: 0, valence: 0.6 },
      d: { arousal: 0, valence: 0.9 },
    };

    expect(
      Object.keys(mixAt({ arousal: 0, valence: 0 }, { k: 2, pool })),
    ).toEqual(['a', 'b']);
  });

  it('brings in sounds with the same coordinates together', () => {
    const pool = {
      far: { arousal: 0, valence: 0.9 },
      one: { arousal: 0, valence: 0.2 },
      three: { arousal: 0, valence: 0.2 },
      two: { arousal: 0, valence: 0.2 },
    };
    const mix = mixAt({ arousal: 0, valence: 0 }, { k: 2, pool });

    expect(mix.one).toBeCloseTo(mix.two);
    expect(mix.two).toBeCloseTo(mix.three);
    expect(mix.far).toBeUndefined();
  });

  it('handles an empty pool and a pool smaller than k', () => {
    expect(mixAt({ arousal: 0, valence: 0 }, { pool: {} })).toEqual({});
    const small = mixAt(
      { arousal: 0, valence: 0 },
      { pool: { x: { arousal: 0.5, valence: 0.5 } } },
    );
    expect(small.x).toBeCloseTo(ENGINE_DEFAULTS.masterGain);
  });
});

describe('study routes', () => {
  const cells = [1, 5, 9].flatMap(p =>
    [1, 5, 9].map(a => fitToPool(cellToPoint({ arousal: a, pleasure: p }))),
  );

  it('have no abrupt entries and only small per-tick steps', () => {
    let routes = 0;

    cells.forEach(start => {
      cells.forEach(target => {
        if (start === target) return;

        shapes.forEach(shape => {
          // two minutes: faster than a study route, so steps are larger
          const route: Route = { duration: 120_000, shape, start, target };
          const samples = planSamples(route);
          const schedule = buildSchedule(samples, route.duration);
          const abrupt = schedule.lanes.flatMap(l =>
            l.segments.filter(s => s.abrupt),
          );

          expect(abrupt, `${shape} route`).toEqual([]);

          let largest = 0;
          samples.forEach((sample, i) => {
            const previous = samples[i - 1];
            if (!previous || sample.t <= ENGINE_DEFAULTS.rampIn) return;

            new Set([
              ...Object.keys(sample.mix),
              ...Object.keys(previous.mix),
            ]).forEach(id => {
              largest = Math.max(
                largest,
                Math.abs((sample.mix[id] ?? 0) - (previous.mix[id] ?? 0)),
              );
            });
          });

          expect(largest).toBeLessThan(0.05);
          routes++;
        });
      });
    });

    expect(routes).toBe(72 * 4);
  }, 120_000);

  it('select every sound a run will make audible', () => {
    shapes.forEach(shape => {
      const route: Route = {
        duration: 60_000,
        shape,
        start: tense,
        target: calm,
      };
      const ids = new Set(trajectorySounds(route));

      for (let ms = 0; ms <= route.duration; ms += 50) {
        Object.entries(frameAt(ms, route).mix).forEach(([id, gain]) => {
          if (gain > 0.02) expect(ids.has(id), `${shape}: ${id}`).toBe(true);
        });
      }
    });
  });

  it('only use sounds from the pool', () => {
    const ids = trajectorySounds({ shape: 'iso', start: tense, target: calm });
    ids.forEach(id => {
      expect(id in affect).toBe(true);
    });
  });
});

describe('runTransition', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays exactly what frameAt plans, excluding paused time', () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });

    const route: Route = {
      duration: 10_000,
      shape: 'iso',
      start: tense,
      target: calm,
    };
    const ids = trajectorySounds(route);
    const written: Array<Record<string, number>> = [];
    let completed = false;

    const handle = runTransition({
      ...route,
      ids,
      onComplete: () => {
        completed = true;
      },
      setVolumes: volumes => written.push(volumes),
    });

    vi.advanceTimersByTime(4000);
    expect(written.at(-1)).toEqual(frameAt(4000, route, ids).mix);

    handle.pause();
    vi.advanceTimersByTime(5000);
    handle.resume();
    expect(written.at(-1)).toEqual(frameAt(4000, route, ids).mix);

    vi.advanceTimersByTime(6000);
    expect(completed).toBe(true);
    expect(written.at(-1)).toEqual(frameAt(10_000, route, ids).mix);
  });
});
