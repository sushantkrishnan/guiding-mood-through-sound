/**
 * Plays sounds from added libraries in the visualiser.
 *
 * Moodist's own sounds keep going through the app's sound store and its
 * Sound components, exactly as in a study session. Sounds from other
 * libraries have no Sound component, so the visualiser plays them here: one
 * looping Howl each, driven by the same per-tick gains.
 *
 * A sound is only playing while its gain is above zero; silent ones pause,
 * because a dense library can put a hundred sounds on one route.
 */

import { Howl } from 'howler';

import { getAssetPath } from '@/helpers/path';

const howls = new Map<string, Howl>();

const LOAD_TIMEOUT = 30_000;

/**
 * Create (and start loading) a Howl for each sound not already loaded.
 * Resolves once every one has loaded or failed, or after a timeout, with
 * the ids that could not be loaded.
 */
export function prepare(
  sounds: Array<{ id: string; src: string | null }>,
): Promise<Array<string>> {
  const pending = sounds
    .filter(sound => sound.src)
    .map(
      sound =>
        new Promise<string | null>(resolve => {
          const existing = howls.get(sound.id);

          if (existing?.state() === 'loaded') return resolve(null);

          const howl =
            existing ??
            new Howl({
              html5: false,
              loop: true,
              preload: true,
              src: [getAssetPath(`/${sound.src}`)],
              volume: 0,
            });

          howls.set(sound.id, howl);
          howl.once('load', () => resolve(null));
          howl.once('loaderror', () => resolve(sound.id));
        }),
    );

  const timeout = new Promise<Array<string>>(resolve =>
    setTimeout(
      () =>
        resolve(
          sounds
            .filter(s => howls.get(s.id)?.state() !== 'loaded')
            .map(s => s.id),
        ),
      LOAD_TIMEOUT,
    ),
  );

  return Promise.race([
    Promise.all(pending).then(ids =>
      ids.filter((id): id is string => id !== null),
    ),
    timeout,
  ]);
}

/** Set every given sound's gain; `master` is the app's global volume. */
export function setVolumes(volumes: Record<string, number>, master = 1) {
  Object.entries(volumes).forEach(([id, gain]) => {
    const howl = howls.get(id);

    if (howl?.state() !== 'loaded') return;

    const volume = gain * master;
    howl.volume(volume);

    if (volume > 0 && !howl.playing()) howl.play();
    else if (volume === 0 && howl.playing()) howl.pause();
  });
}

/** Silence everything, and unload sounds no longer needed. */
export function stop(keep: Set<string> = new Set()) {
  howls.forEach((howl, id) => {
    howl.stop();

    if (!keep.has(id)) {
      howl.unload();
      howls.delete(id);
    }
  });
}
