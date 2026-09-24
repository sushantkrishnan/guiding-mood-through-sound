import { describe, expect, it } from 'vitest';

import { buildInfo, mapHash } from './provenance';

describe('mapHash', () => {
  const map = {
    a: { arousal: 0.1, valence: 0.2 },
    b: { arousal: -0.3, valence: 0.4 },
  };

  it('is stable and ignores key order', () => {
    expect(mapHash(map)).toBe(mapHash({ b: map.b, a: map.a }));
    expect(mapHash(map)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when a sound moves, appears or disappears', () => {
    const base = mapHash(map);

    expect(mapHash({ ...map, a: { arousal: 0.1, valence: 0.25 } })).not.toBe(
      base,
    );
    expect(mapHash({ ...map, c: { arousal: 0, valence: 0 } })).not.toBe(base);
    expect(mapHash({ a: map.a })).not.toBe(base);
  });
});

describe('buildInfo', () => {
  it('is empty outside a build', () => {
    expect(buildInfo()).toEqual({ builtAt: null, commit: null, dirty: null });
  });
});
