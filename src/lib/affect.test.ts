import { describe, expect, it } from 'vitest';

import {
  affect,
  affectCategory,
  cellDistance,
  cellToPoint,
  extentOf,
  fitToPool,
} from './affect';

describe('grid', () => {
  it('maps cells 1..9 onto -1..+1', () => {
    expect(cellToPoint({ arousal: 5, pleasure: 5 })).toEqual({
      arousal: 0,
      valence: 0,
    });
    expect(cellToPoint({ arousal: 9, pleasure: 1 })).toEqual({
      arousal: 1,
      valence: -1,
    });
    expect(
      cellDistance({ arousal: 1, pleasure: 1 }, { arousal: 4, pleasure: 5 }),
    ).toBe(5);
  });
});

describe('fitToPool', () => {
  const extent = extentOf(affect);

  it('keeps neutral at neutral and the grid edges at the pool edges', () => {
    expect(fitToPool({ arousal: 0, valence: 0 })).toEqual({
      arousal: 0,
      valence: 0,
    });
    expect(fitToPool({ arousal: -1, valence: 1 })).toEqual({
      arousal: extent.arousal[0],
      valence: extent.valence[1],
    });
    expect(fitToPool({ arousal: 1, valence: -1 })).toEqual({
      arousal: extent.arousal[1],
      valence: extent.valence[0],
    });
  });
});

describe('affect map', () => {
  it('gives every sound a category', () => {
    Object.keys(affect).forEach(id => {
      expect(affectCategory[id], id).toBeTruthy();
    });
  });
});
