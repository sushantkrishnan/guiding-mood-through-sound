import { sounds } from '@/data/sounds';

/**
 * Counts the total number of sounds across all categories.
 *
 * @param {boolean} [round=false] - Whether to round the count down to the nearest multiple of 5.
 * @returns {number} The total count of sounds, optionally rounded down.
 */
export function count(round: boolean = false) {
  let count = 0;

  sounds.categories.forEach(category => {
    count += category.sounds.length;
  });

  if (round) {
    return count - (count % 5);
  }

  return count;
}

let sources: Record<string, string> | null = null;

/** sounds from other libraries, registered by the visualiser when it loads them */
const extra: Record<string, { label: string; src: string | null }> = {};

/**
 * Make sounds from outside Moodist's own library known to the label and
 * source lookups below.
 */
export function registerSounds(
  entries: Record<string, { label: string; src: string | null }>,
) {
  Object.assign(extra, entries);
}

/**
 * Looks up a sound's audio source by its id.
 *
 * @param {string} id - The sound id, e.g. `light-rain`.
 * @returns {string | undefined} The sound's `src`, or undefined if unknown.
 */
export function getSoundSrc(id: string) {
  if (id in extra) return extra[id].src ?? undefined;

  if (!sources) {
    const map: Record<string, string> = {};

    sounds.categories.forEach(category => {
      category.sounds.forEach(sound => {
        map[sound.id] = sound.src;
      });
    });

    sources = map;
  }

  return sources[id];
}

/**
 * Looks up a sound's display label by its id, falling back to the id.
 */
export function getSoundLabel(id: string) {
  if (id in extra) return extra[id].label;

  for (const category of sounds.categories) {
    const sound = category.sounds.find(sound => sound.id === id);

    if (sound) return sound.label;
  }

  return id;
}
