/**
 * Sound libraries for the visualiser.
 *
 * Moodist's own sounds are built in. Other libraries are fetched and
 * converted by `scripts/libraries/build.py` into public/libraries/, which is
 * gitignored: licences vary (some non-commercial, one unstated), so a library
 * is only published deliberately, never by committing it. The visualiser
 * reads whatever is installed at runtime.
 *
 * Library sound ids are prefixed with the library ("emo:…", "isd:…") so they
 * can never collide with Moodist's.
 */

import { affect, type AffectMap, type AffectPoint } from './affect';
import { getAssetPath } from '@/helpers/path';
import { registerSounds } from './sounds';
import { sounds as moodistSounds } from '@/data/sounds';

export interface LibrarySound {
  arousal: number;
  category?: string;
  credit?: string | null;
  /** seconds; null when the audio isn't downloaded yet */
  duration?: number | null;
  id: string;
  label: string;
  /** original clip level before the library was level-matched, dBFS RMS */
  levelDb?: number;
  /** number of ratings behind the coordinate, when the source says */
  n?: number;
  /** path under public/, or null when only the ratings are installed */
  src: string | null;
  url?: string | null;
  valence: number;
}

export interface Library {
  builtIn?: boolean;
  citation?: string;
  /** median clip length in seconds */
  clipSeconds: number | null;
  /** how the source's ratings became engine coordinates */
  coordinates: string;
  count: number;
  id: string;
  /** dB applied to match Moodist's median level */
  levelShiftDb?: number;
  licence: string;
  /** e.g. "CC BY 4.0" */
  licenceShort?: string;
  name: string;
  /** may go on a public, non-commercial site with the credits in CREDITS.txt */
  publishable: boolean;
  sounds: Array<LibrarySound>;
  source: string;
}

export const MOODIST_ID = 'moodist';

/** Moodist's own library, from the provisional affect map. */
export const moodist: Library = (() => {
  const labels: Record<string, string> = {};
  const srcs: Record<string, string> = {};

  moodistSounds.categories.forEach(category => {
    category.sounds.forEach(sound => {
      labels[sound.id] = sound.label;
      srcs[sound.id] = sound.src;
    });
  });

  const sounds = Object.entries(affect).map(([id, point]) => ({
    ...point,
    id,
    label: labels[id] ?? id,
    src: srcs[id] ?? null,
  }));

  return {
    builtIn: true,
    clipSeconds: null,
    coordinates:
      'Provisional author ratings in src/lib/affect.ts, not yet grounded in listener data.',
    count: sounds.length,
    id: MOODIST_ID,
    licence: 'CC0 and Pixabay Content License (as upstream Moodist)',
    licenceShort: 'CC0 / Pixabay',
    name: 'Moodist',
    publishable: true,
    sounds,
    source: 'https://github.com/remvze/moodist',
  };
})();

/** Which library a sound id belongs to. */
export function libraryOf(id: string) {
  const colon = id.indexOf(':');

  return colon === -1 ? MOODIST_ID : id.slice(0, colon);
}

/**
 * Every library installed under public/libraries/, plus Moodist. Resolves
 * to just Moodist when nothing is installed (or the index can't be read).
 */
export async function loadLibraries(): Promise<Array<Library>> {
  let index: Array<{ file: string; id: string }> = [];

  try {
    const response = await fetch(getAssetPath('/libraries/index.json'));
    if (response.ok) index = await response.json();
  } catch {
    // not installed
  }

  const loaded = await Promise.all(
    index.map(async entry => {
      try {
        const response = await fetch(getAssetPath(`/libraries/${entry.file}`));

        return response.ok ? ((await response.json()) as Library) : null;
      } catch {
        return null;
      }
    }),
  );

  const libraries = loaded.filter((l): l is Library => l !== null);

  // manifests use their own short prefixes (emo:, isd:); remember the owner
  const entries: Record<string, { label: string; src: string | null }> = {};
  libraries.forEach(library => {
    library.sounds.forEach(sound => {
      entries[sound.id] = { label: sound.label, src: sound.src };
    });
  });
  registerSounds(entries);

  return [moodist, ...libraries];
}

/** The engine pool for a set of enabled libraries. */
export function poolOf(
  libraries: Array<Library>,
  enabled: Set<string>,
): AffectMap {
  const pool: AffectMap = {};

  libraries
    .filter(library => enabled.has(library.id))
    .forEach(library => {
      library.sounds.forEach(sound => {
        pool[sound.id] = { arousal: sound.arousal, valence: sound.valence };
      });
    });

  return pool;
}

/** Which library owns each sound id, across the given libraries. */
export function ownerIndex(libraries: Array<Library>) {
  const owners: Record<string, Library> = {};

  libraries.forEach(library => {
    library.sounds.forEach(sound => {
      owners[sound.id] = library;
    });
  });

  return owners;
}

export type Region = 'calm' | 'excited' | 'tense' | 'low' | 'neutral';

export const REGIONS: Array<{ hint: string; id: Region; label: string }> = [
  { hint: 'pleasant, low energy', id: 'calm', label: 'Calm' },
  { hint: 'pleasant, high energy', id: 'excited', label: 'Excited' },
  { hint: 'unpleasant, high energy', id: 'tense', label: 'Tense' },
  { hint: 'unpleasant, low energy', id: 'low', label: 'Low' },
  { hint: 'near the centre', id: 'neutral', label: 'Neutral' },
];

/** The mood-map region a point falls in; the centre band is |v|,|a| < 0.15. */
export function regionOf(point: AffectPoint): Region {
  if (Math.abs(point.valence) < 0.15 && Math.abs(point.arousal) < 0.15)
    return 'neutral';
  if (point.valence >= 0) return point.arousal >= 0 ? 'excited' : 'calm';

  return point.arousal >= 0 ? 'tense' : 'low';
}

export function coverage(library: Library) {
  const counts: Record<Region, number> = {
    calm: 0,
    excited: 0,
    low: 0,
    neutral: 0,
    tense: 0,
  };

  library.sounds.forEach(sound => {
    counts[regionOf(sound)]++;
  });

  return counts;
}

/**
 * Libraries worth having that can't be fetched automatically, and what it
 * takes to add each. Once obtained, any of them can be imported with
 * `python3 scripts/libraries/build.py custom <folder>`.
 */
export const NOT_INSTALLED: Array<{ name: string; need: string; url: string }> =
  [
    {
      name: 'IADS-E (935 sounds)',
      need: 'Submit the request form; a private download link is emailed. Academic, non-commercial use.',
      url: 'https://sites.google.com/psych.hiroshima-u.ac.jp/iads-e/english',
    },
    {
      name: 'IADS-2 (167 sounds)',
      need: 'Request from the original authors at the University of Florida (CSEA).',
      url: 'https://csea.phhp.ufl.edu/media.html',
    },
    {
      name: 'Affective Audio Dataset (780 BBC sounds)',
      need: 'Nathan has the paper: check its data availability section. The audio is BBC, so research use only.',
      url: 'https://ieeexplore.ieee.org/document/10621594/',
    },
    {
      name: 'Full-length Emo-Soundscapes sources',
      need: 'A Freesound API key (free account). The six-second clips come from full recordings that loop far better.',
      url: 'https://freesound.org/apiv2/apply/',
    },
    {
      name: 'BBC Sound Effects',
      need: 'Pick sounds by hand under the RemArc licence (research and education only), rate or place them, and import them as a custom library.',
      url: 'https://sound-effects.bbcrewind.co.uk/',
    },
    {
      name: 'Sonniss GDC bundles',
      need: 'Tens of GB and unrated; download a bundle, pick the ambiences you need, and place them yourselves.',
      url: 'https://gdc.sonniss.com/',
    },
  ];
