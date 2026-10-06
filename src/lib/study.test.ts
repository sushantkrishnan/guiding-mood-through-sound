import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETUP,
  firstTarget,
  orderFor,
  probeTimes,
  ratingSounds,
  resolveTarget,
  sequencesFor,
  sincePrevious,
  targetExposure,
  williams,
  type SessionLog,
} from './study';

describe('williams', () => {
  [2, 3, 4, 5].forEach(n => {
    it(`balances position and carry-over for ${n} conditions`, () => {
      const conditions = Array.from({ length: n }, (_, i) => i);
      const rows = williams(conditions);

      expect(rows).toHaveLength(sequencesFor(n));

      // every condition equally often in every position
      for (let position = 0; position < n; position++) {
        const counts = new Map<number, number>();
        rows.forEach(row => {
          counts.set(row[position], (counts.get(row[position]) ?? 0) + 1);
        });
        expect(new Set(counts.values()).size).toBe(1);
        expect(counts.size).toBe(n);
      }

      // every condition follows every other equally often
      const pairs = new Map<string, number>();
      rows.forEach(row => {
        row.slice(1).forEach((c, i) => {
          const key = `${row[i]}>${c}`;
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        });
      });
      expect(pairs.size).toBe(n * (n - 1));
      expect(new Set(pairs.values()).size).toBe(1);
    });
  });

  it('cycles participants through the sequences', () => {
    const conditions = ['a', 'b', 'c'];
    expect(orderFor(1, conditions)).toEqual(orderFor(7, conditions));
    expect(orderFor(1, conditions)).not.toEqual(orderFor(2, conditions));
  });

  // the protocol's facilitator instructions and debrief depend on this
  it('gives odd participants guided first and even ones fixed first', () => {
    expect(orderFor(1, DEFAULT_SETUP.conditions)).toEqual(['iso', 'direct']);
    expect(orderFor(2, DEFAULT_SETUP.conditions)).toEqual(['direct', 'iso']);
    expect(orderFor(3, DEFAULT_SETUP.conditions)).toEqual(['iso', 'direct']);
  });
});

describe('probeTimes', () => {
  it('asks halfway through the movement and on arrival', () => {
    expect(
      probeTimes({ checkIns: 'phases', duration: 10, probeInterval: 2 }),
    ).toEqual([270_000, 480_000]);
  });

  it('supports fixed intervals and none', () => {
    expect(
      probeTimes({ checkIns: 'interval', duration: 10, probeInterval: 2 }),
    ).toEqual([120_000, 240_000, 360_000, 480_000]);
    expect(
      probeTimes({ checkIns: 'none', duration: 10, probeInterval: 2 }),
    ).toEqual([]);
  });

  it('checks in at 2 and 4 minutes with the default (protocol) setup', () => {
    expect(probeTimes(DEFAULT_SETUP)).toEqual([120_000, 240_000]);
  });
});

describe('targetExposure', () => {
  it('counts time within the radius of the target', () => {
    const trace = [
      { a: 0.5, m: {}, t: 0, v: 0.5 },
      { a: 0, m: {}, t: 1000, v: 0 },
      { a: 0, m: {}, t: 3000, v: 0.05 },
      { a: 0, m: {}, t: 4000, v: 0 },
    ];

    expect(targetExposure(trace, { arousal: 0, valence: 0 })).toBe(3000);
  });
});

const fakeLog = (partial: Partial<SessionLog>) =>
  ({
    endedAt: null,
    measures: { target: null },
    participantId: 'P01',
    route: null,
    session: 1,
    trace: [],
    ...partial,
  }) as unknown as SessionLog;

describe('earlier sessions', () => {
  it('finds the first target in v2 and v1 logs', () => {
    const v2 = fakeLog({
      route: {
        to: { grid: { arousal: 2, pleasure: 8 } },
      } as SessionLog['route'],
      session: 2,
    });
    const v1 = fakeLog({
      measures: {
        target: { arousal: 0, grid: { arousal: 3, pleasure: 7 }, valence: 0 },
      } as SessionLog['measures'],
      session: 1,
    });

    expect(firstTarget([v2, v1], 'P01')).toEqual({ arousal: 3, pleasure: 7 });
    expect(firstTarget([v2, v1], 'P02')).toBeNull();
  });

  it('measures time since the previous session', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    const logs = [
      fakeLog({ endedAt: '2026-09-25T10:00:00Z', session: 1 }),
      fakeLog({ endedAt: '2026-09-25T11:00:00Z', session: 2 }),
    ];

    expect(sincePrevious(logs, 'P01', 3, now)).toBe(3_600_000);
    expect(sincePrevious(logs, 'P01', 2, now)).toBe(7_200_000);
    expect(sincePrevious(logs, 'P09', 1, now)).toBeNull();
  });
});

describe('resolveTarget', () => {
  const calm = { arousal: 3, pleasure: 7 };
  const chosen = fakeLog({
    route: { to: { grid: { arousal: 2, pleasure: 8 } } } as SessionLog['route'],
  });

  it('uses the fixed cell in every session', () => {
    [1, 2].forEach(session => {
      expect(
        resolveTarget(
          { fixedTarget: calm, session, targetMode: 'fixed' },
          [],
          'P01',
        ),
      ).toEqual({ cell: calm, source: 'fixed' });
    });
  });

  it('reuses the first session only after it, and leaves choosing open', () => {
    const first = { fixedTarget: calm, targetMode: 'first' as const };

    expect(resolveTarget({ ...first, session: 1 }, [chosen], 'P01')).toBeNull();
    expect(resolveTarget({ ...first, session: 2 }, [chosen], 'P01')).toEqual({
      cell: { arousal: 2, pleasure: 8 },
      source: 'first-session',
    });
    // needed but not saved in this browser
    expect(resolveTarget({ ...first, session: 2 }, [], 'P01')).toBeUndefined();
    expect(
      resolveTarget(
        { fixedTarget: calm, session: 2, targetMode: 'choose' },
        [chosen],
        'P01',
      ),
    ).toBeNull();
  });
});

describe('ratingSounds', () => {
  const log = fakeLog({
    trace: [
      { a: 0, m: { 'light-rain': 0.7, waves: 0.2 }, t: 0, v: 0 },
      {
        a: 0,
        m: { campfire: 0.5, 'not-a-sound': 0.9, waves: 0.2 },
        t: 1000,
        v: 0,
      },
      { a: 0, m: {}, t: 3000, v: 0 },
    ],
  });

  it('picks the sounds heard most, reproducibly shuffled', () => {
    const picked = ratingSounds([log], 2, 1);

    expect([...picked].sort()).toEqual(['campfire', 'light-rain']);
    expect(ratingSounds([log], 2, 1)).toEqual(picked);
    expect(ratingSounds([log], 10, 1)).toHaveLength(3);
  });
});
