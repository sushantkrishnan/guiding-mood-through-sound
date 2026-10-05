import { afterEach, describe, expect, it, vi } from 'vitest';

import { affect, affectCategory } from './affect';
import {
  categoriesOf,
  coverage,
  type Library,
  libraryOf,
  loadLibraries,
  MOODIST_ID,
  moodist,
  ownerIndex,
  poolOf,
  regionOf,
} from './libraries';
import { getSoundLabel, getSoundSrc } from './sounds';

/** a small added library, as scripts/libraries/build.py would write it */
function library(id: string, sounds: Library['sounds']): Library {
  return {
    clipSeconds: 6,
    coordinates: 'test',
    count: sounds.length,
    id,
    licence: 'test',
    name: id,
    publishable: false,
    sounds,
    source: 'test',
  };
}

const emo = library('emo', [
  {
    arousal: 0.5,
    category: 'nature',
    id: 'emo:1',
    label: 'Brook',
    src: null,
    valence: 0.6,
  },
  { arousal: -0.4, id: 'emo:2', label: 'Hum', src: null, valence: -0.3 },
]);

describe('libraryOf', () => {
  it('reads the library from the id prefix, Moodist when there is none', () => {
    expect(libraryOf('rain')).toBe(MOODIST_ID);
    expect(libraryOf('emo:123')).toBe('emo');
    expect(libraryOf('isd:a:b')).toBe('isd');
  });
});

describe('moodist', () => {
  it('has one sound per mapped coordinate, each with its audio', () => {
    expect(moodist.count).toBe(Object.keys(affect).length);
    moodist.sounds.forEach(sound => {
      expect(sound.src, sound.id).toBeTruthy();
      expect(sound.label, sound.id).not.toBe(sound.id);
    });
  });
});

describe('poolOf', () => {
  it('pools only the enabled libraries', () => {
    expect(Object.keys(poolOf([moodist, emo], new Set(['emo'])))).toEqual([
      'emo:1',
      'emo:2',
    ]);

    const both = poolOf([moodist, emo], new Set([MOODIST_ID, 'emo']));
    expect(Object.keys(both)).toHaveLength(moodist.count + 2);
    expect(both['emo:1']).toEqual({ arousal: 0.5, valence: 0.6 });
  });
});

describe('categoriesOf', () => {
  it("keeps Moodist's categories and namespaces each added library's", () => {
    const categories = categoriesOf([moodist, emo]);

    Object.keys(affect).forEach(id => {
      expect(categories[id], id).toBe(affectCategory[id]);
    });
    // "nature" in another library is not Moodist's nature
    expect(categories['emo:1']).toBe('emo/nature');
    expect(categories['emo:2']).toBe('emo');
  });
});

describe('ownerIndex', () => {
  it('maps every sound id to its library', () => {
    const owners = ownerIndex([moodist, emo]);

    expect(owners['emo:2']).toBe(emo);
    expect(owners[moodist.sounds[0].id]).toBe(moodist);
  });
});

describe('regionOf', () => {
  it('puts each quadrant in its region and the centre band in neutral', () => {
    expect(regionOf({ arousal: -0.5, valence: 0.5 })).toBe('calm');
    expect(regionOf({ arousal: 0.5, valence: 0.5 })).toBe('excited');
    expect(regionOf({ arousal: 0.5, valence: -0.5 })).toBe('tense');
    expect(regionOf({ arousal: -0.5, valence: -0.5 })).toBe('low');
    expect(regionOf({ arousal: -0.14, valence: 0.14 })).toBe('neutral');
  });

  it('leaves the centre band once either axis reaches 0.15', () => {
    expect(regionOf({ arousal: 0, valence: 0.15 })).toBe('excited');
    expect(regionOf({ arousal: -0.15, valence: 0 })).toBe('calm');
  });
});

describe('coverage', () => {
  it('counts every sound in exactly one region', () => {
    expect(coverage(emo)).toEqual({
      calm: 0,
      excited: 1,
      low: 1,
      neutral: 0,
      tense: 0,
    });

    const counts = Object.values(coverage(moodist));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(moodist.count);
  });
});

describe('loadLibraries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves to just Moodist when nothing is installed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(await loadLibraries()).toEqual([moodist]);
  });

  it('adds installed libraries, skips unreadable ones, and registers their sounds', async () => {
    const isd = library('isd', [
      {
        arousal: 0,
        id: 'isd:7',
        label: 'Square',
        src: '/libraries/isd/7.mp3',
        valence: 0,
      },
    ]);
    const files: Record<string, unknown> = {
      '/libraries/index.json': [
        { file: 'isd/library.json', id: 'isd' },
        { file: 'broken/library.json', id: 'broken' },
      ],
      '/libraries/isd/library.json': isd,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url in files
          ? { json: async () => files[url], ok: true }
          : { json: async () => null, ok: false },
      ),
    );

    const loaded = await loadLibraries();

    expect(loaded.map(l => l.id)).toEqual([MOODIST_ID, 'isd']);
    expect(getSoundLabel('isd:7')).toBe('Square');
    expect(getSoundSrc('isd:7')).toBe('/libraries/isd/7.mp3');
  });
});
