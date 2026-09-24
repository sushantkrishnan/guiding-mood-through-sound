/**
 * Provisional valence/arousal coordinates for every Moodist sound.
 *
 * PROVISIONAL: these are first-pass author ratings used to get the transition
 * engine running. They are NOT the study's stimulus labels. Before the pilot
 * they must be replaced by empirically derived coordinates (see the options in
 * docs/proposal-sections.md §4.2) — either by anchoring to published
 * affective-norm datasets (IADS-2 / IADS-E / Emo-Soundscapes) or by our own
 * rating pass. The study harness collects listener ratings of the sounds each
 * participant heard (the rating block at the end of the final session).
 *
 * valence: -1 (unpleasant) .. +1 (pleasant)
 * arousal: -1 (calm/sleepy) .. +1 (activated/agitated)
 */

export interface AffectPoint {
  arousal: number;
  valence: number;
}

export type AffectMap = Record<string, AffectPoint>;

/**
 * One cell of Russell, Weiss & Mendelsohn's (1989) Affect Grid, scored 1..9
 * on each axis as in the original instrument.
 */
export interface GridCell {
  arousal: number;
  pleasure: number;
}

const GRID_MID = 5;

/** Grid scores (1..9) → engine coordinates (-1..+1). */
export function cellToPoint(cell: GridCell): AffectPoint {
  return {
    arousal: (cell.arousal - GRID_MID) / (GRID_MID - 1),
    valence: (cell.pleasure - GRID_MID) / (GRID_MID - 1),
  };
}

/** Distance between two grid answers, in cells. */
export function cellDistance(a: GridCell, b: GridCell) {
  return Math.hypot(a.arousal - b.arousal, a.pleasure - b.pleasure);
}

/**
 * Coordinates grouped by Moodist category. The category is used by the
 * engine to keep a mix to one scene (see `coherence` in transition.ts).
 */
const groups: Record<string, AffectMap> = {
  animals: {
    beehive: { arousal: 0.3, valence: -0.2 },
    birds: { arousal: -0.1, valence: 0.7 },
    'cat-purring': { arousal: -0.6, valence: 0.8 },
    chickens: { arousal: 0.1, valence: 0.2 },
    cows: { arousal: -0.2, valence: 0.3 },
    crickets: { arousal: -0.5, valence: 0.5 },
    crows: { arousal: 0.2, valence: -0.4 },
    'dog-barking': { arousal: 0.5, valence: -0.4 },
    frog: { arousal: -0.3, valence: 0.3 },
    'horse-gallop': { arousal: 0.5, valence: 0.1 },
    owl: { arousal: -0.3, valence: 0.1 },
    seagulls: { arousal: 0.2, valence: 0.3 },
    sheep: { arousal: -0.2, valence: 0.3 },
    whale: { arousal: -0.6, valence: 0.4 },
    wolf: { arousal: 0.3, valence: -0.3 },
    woodpecker: { arousal: 0.2, valence: 0.1 },
  },
  nature: {
    campfire: { arousal: -0.4, valence: 0.8 },
    droplets: { arousal: -0.4, valence: 0.4 },
    'howling-wind': { arousal: 0.3, valence: -0.4 },
    jungle: { arousal: 0.1, valence: 0.3 },
    river: { arousal: -0.2, valence: 0.7 },
    'walk-in-snow': { arousal: -0.1, valence: 0.3 },
    'walk-on-gravel': { arousal: 0.0, valence: 0.1 },
    'walk-on-leaves': { arousal: -0.1, valence: 0.4 },
    waterfall: { arousal: 0.2, valence: 0.5 },
    waves: { arousal: -0.3, valence: 0.7 },
    wind: { arousal: 0.0, valence: 0.1 },
    'wind-in-trees': { arousal: -0.3, valence: 0.6 },
  },
  noise: {
    'brown-noise': { arousal: -0.4, valence: 0.3 },
    'pink-noise': { arousal: -0.1, valence: 0.1 },
    'white-noise': { arousal: 0.2, valence: -0.1 },
  },
  places: {
    airport: { arousal: 0.4, valence: -0.3 },
    cafe: { arousal: 0.2, valence: 0.4 },
    carousel: { arousal: 0.4, valence: 0.3 },
    church: { arousal: -0.3, valence: 0.2 },
    'construction-site': { arousal: 0.7, valence: -0.8 },
    'crowded-bar': { arousal: 0.6, valence: 0.0 },
    laboratory: { arousal: 0.1, valence: -0.1 },
    'laundry-room': { arousal: -0.1, valence: 0.1 },
    library: { arousal: -0.4, valence: 0.4 },
    'night-village': { arousal: -0.4, valence: 0.4 },
    office: { arousal: 0.2, valence: -0.1 },
    restaurant: { arousal: 0.3, valence: 0.3 },
    'subway-station': { arousal: 0.5, valence: -0.5 },
    supermarket: { arousal: 0.2, valence: -0.2 },
    temple: { arousal: -0.5, valence: 0.4 },
    underwater: { arousal: -0.5, valence: 0.2 },
  },
  rain: {
    'heavy-rain': { arousal: 0.1, valence: 0.4 },
    'light-rain': { arousal: -0.4, valence: 0.7 },
    'rain-on-car-roof': { arousal: -0.2, valence: 0.6 },
    'rain-on-leaves': { arousal: -0.3, valence: 0.7 },
    'rain-on-tent': { arousal: -0.4, valence: 0.7 },
    'rain-on-umbrella': { arousal: -0.2, valence: 0.6 },
    'rain-on-window': { arousal: -0.5, valence: 0.8 },
    thunder: { arousal: 0.6, valence: -0.2 },
  },
  things: {
    'boiling-water': { arousal: 0.1, valence: 0.2 },
    bubbles: { arousal: 0.0, valence: 0.4 },
    'ceiling-fan': { arousal: -0.2, valence: 0.2 },
    clock: { arousal: -0.1, valence: -0.1 },
    dryer: { arousal: 0.0, valence: 0.0 },
    keyboard: { arousal: 0.3, valence: 0.0 },
    'morse-code': { arousal: 0.2, valence: -0.1 },
    paper: { arousal: -0.1, valence: 0.2 },
    'singing-bowl': { arousal: -0.6, valence: 0.6 },
    'slide-projector': { arousal: 0.0, valence: 0.0 },
    'tuning-radio': { arousal: 0.3, valence: -0.3 },
    typewriter: { arousal: 0.3, valence: 0.1 },
    'vinyl-effect': { arousal: -0.2, valence: 0.4 },
    'fluorescent-hum': { arousal: -0.35, valence: -0.45 },
    'washing-machine': { arousal: 0.0, valence: 0.0 },
    'wind-chimes': { arousal: -0.3, valence: 0.6 },
    'windshield-wipers': { arousal: 0.0, valence: 0.1 },
  },
  transport: {
    airplane: { arousal: 0.1, valence: 0.1 },
    'inside-a-train': { arousal: -0.1, valence: 0.4 },
    'rowing-boat': { arousal: -0.3, valence: 0.5 },
    sailboat: { arousal: -0.3, valence: 0.5 },
    submarine: { arousal: -0.2, valence: -0.1 },
    train: { arousal: 0.2, valence: 0.2 },
  },
  urban: {
    'ambulance-siren': { arousal: 0.9, valence: -0.9 },
    'busy-street': { arousal: 0.5, valence: -0.5 },
    crowd: { arousal: 0.5, valence: -0.3 },
    fireworks: { arousal: 0.7, valence: 0.2 },
    highway: { arousal: 0.3, valence: -0.3 },
    road: { arousal: 0.2, valence: -0.2 },
    traffic: { arousal: 0.5, valence: -0.6 },
  },
};

export const affect: AffectMap = Object.assign({}, ...Object.values(groups));

/** Moodist category of every sound in `affect`, e.g. `rain`. */
export const affectCategory: Record<string, string> = Object.fromEntries(
  Object.entries(groups).flatMap(([category, sounds]) =>
    Object.keys(sounds).map(id => [id, category]),
  ),
);

/**
 * NOT part of the engine's pool. `src/data/sounds/binaural.tsx` is never
 * registered in `src/data/sounds.ts`, so these five have no entry in the sound
 * store and no Sound component — the binaural feature is a separate modal that
 * synthesises tones with Web Audio oscillators. Scheduling them silently
 * produced gaps in the mix, so they are kept here for reference only.
 */
export const orphanedAffect: AffectMap = {
  'binaural-alpha': { arousal: -0.2, valence: 0.2 },
  'binaural-beta': { arousal: 0.4, valence: 0.0 },
  'binaural-delta': { arousal: -0.8, valence: 0.0 },
  'binaural-gamma': { arousal: 0.7, valence: -0.1 },
  'binaural-theta': { arousal: -0.5, valence: 0.1 },
};

export const affectIds = Object.keys(affect);

export function distance(a: AffectPoint, b: AffectPoint) {
  const dv = a.valence - b.valence;
  const da = a.arousal - b.arousal;

  return Math.sqrt(dv * dv + da * da);
}

/** The range each axis of a pool covers, always including neutral (0). */
export interface Extent {
  arousal: [number, number];
  valence: [number, number];
}

export function extentOf(pool: AffectMap): Extent {
  const extent: Extent = { arousal: [0, 0], valence: [0, 0] };

  Object.values(pool).forEach(point => {
    extent.arousal[0] = Math.min(extent.arousal[0], point.arousal);
    extent.arousal[1] = Math.max(extent.arousal[1], point.arousal);
    extent.valence[0] = Math.min(extent.valence[0], point.valence);
    extent.valence[1] = Math.max(extent.valence[1], point.valence);
  });

  return extent;
}

/**
 * Map a point on the full -1..+1 grid into the part of the map a pool
 * actually covers. The grid runs to ±1 but the sounds do not (Moodist's
 * arousal stops at -0.6), so an unfitted "sleepy" target asks for a mix that
 * does not exist. Each half-axis is scaled on its own so neutral stays
 * neutral: the most pleasant grid column maps to the most pleasant sound,
 * the most unpleasant column to the most unpleasant, and so on.
 */
export function fitToPool(point: AffectPoint, pool: AffectMap = affect) {
  const extent = extentOf(pool);
  const scale = (value: number, [low, high]: [number, number]) =>
    value < 0 ? -value * low : value * high;

  return {
    arousal: scale(point.arousal, extent.arousal),
    valence: scale(point.valence, extent.valence),
  };
}
