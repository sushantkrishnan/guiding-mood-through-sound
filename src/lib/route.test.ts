import { describe, expect, it } from 'vitest';

import { buildSchedule, routeStats, type Sample } from './route';

const sample = (t: number, mix: Record<string, number>): Sample => ({
  mix,
  position: { arousal: 0, valence: 0 },
  t,
});

describe('buildSchedule', () => {
  it('flags a sound that enters loud after the ramp-in', () => {
    const samples = [
      sample(0, { a: 0.5 }),
      sample(4000, { a: 0.5 }),
      sample(4050, { a: 0.5, b: 0.4 }),
      sample(4100, { a: 0.5, b: 0.4, c: 0.01 }),
      sample(4150, { a: 0.5, b: 0.4, c: 0.03 }),
    ];
    const schedule = buildSchedule(samples, 5000, { rampIn: 3000 });
    const abrupt = schedule.lanes.filter(l => l.segments.some(s => s.abrupt));

    expect(abrupt.map(l => l.id)).toEqual(['b']);
  });
});

describe('routeStats', () => {
  it('reports mix change per minute, ignoring the ramp-in', () => {
    const samples = [
      sample(0, { a: 0 }),
      sample(3000, { a: 0.7 }),
      sample(33_000, { a: 0.4 }),
      sample(63_000, { a: 0.7 }),
    ];
    const schedule = buildSchedule(samples, 63_000);

    expect(routeStats(schedule, null, { rampIn: 3000 }).change).toBeCloseTo(
      0.6,
    );
  });
});
