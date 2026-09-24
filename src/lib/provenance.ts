/**
 * What a session log was made with, so logs stay interpretable after the
 * affect map or the engine changes (the provisional coordinates will be
 * replaced by listener ratings between the pilot and the main study).
 */

import type { AffectMap } from './affect';

export interface BuildInfo {
  builtAt: string | null;
  /** short git commit the site was built from */
  commit: string | null;
  /** the build had uncommitted changes */
  dirty: boolean | null;
}

/** Set by astro.config.mjs at build time; absent under vitest. */
declare const __BUILD__: BuildInfo | undefined;

export function buildInfo(): BuildInfo {
  return typeof __BUILD__ === 'undefined'
    ? { builtAt: null, commit: null, dirty: null }
    : __BUILD__;
}

/**
 * A short fingerprint of an affect map: FNV-1a over every sound's id and
 * coordinates, in id order. Any moved, added or removed sound changes it.
 */
export function mapHash(map: AffectMap) {
  let hash = 0x811c9dc5;
  const text = Object.keys(map)
    .sort()
    .map(id => `${id}:${map[id].valence}:${map[id].arousal}`)
    .join(';');

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
