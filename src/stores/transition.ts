import { create } from 'zustand';

import {
  runTransition,
  trajectorySounds,
  type EngineHandle,
  type Route,
  type TickState,
} from '@/lib/transition';
import { getSoundSrc } from '@/lib/sounds';
import { useSoundStore } from './sound';
import { useLoadingStore } from './loading';

import type { AffectPoint } from '@/lib/affect';

/** give up waiting for audio after this long and start anyway */
const LOAD_TIMEOUT = 30_000;

export type TransitionStatus = 'idle' | 'loading' | 'running' | 'complete';

export interface TransitionConfig extends Route {
  tickRate?: number;
}

export interface TransitionHooks {
  onComplete?: () => void;
  /** called once audio has loaded, just before the clock starts */
  onReady?: (info: { loadMs: number; missing: Array<string> }) => void;
  onTick?: (state: TickState) => void;
}

interface TransitionStore {
  /**
   * Select and preload every sound on the path, wait for the audio, then run.
   * Resolves `false` if the run was cancelled while loading.
   */
  begin: (
    config: TransitionConfig,
    hooks?: TransitionHooks,
  ) => Promise<boolean>;
  /** Stop moving. Whatever is audible keeps playing; silent sounds are released. */
  cancel: () => void;
  config: TransitionConfig | null;
  ids: Array<string>;
  mix: Record<string, number>;
  position: AffectPoint | null;
  status: TransitionStatus;
  t: number;
}

let handle: EngineHandle | null = null;
let unsubscribeSound: (() => void) | null = null;
let token = 0;

function detach() {
  handle?.cancel();
  handle = null;
  unsubscribeSound?.();
  unsubscribeSound = null;
}

/**
 * Resolve once every sound's audio has decoded, or after `timeout` ms.
 * Resolves with the ids that were still loading.
 */
export function waitForSounds(ids: Array<string>, timeout = LOAD_TIMEOUT) {
  const pending = () =>
    ids.filter(id => {
      const src = getSoundSrc(id);

      return src && useLoadingStore.getState().loaders[src] !== false;
    });

  return new Promise<Array<string>>(resolve => {
    if (!pending().length) return resolve([]);

    const timer = setTimeout(() => {
      unsubscribe();
      resolve(pending());
    }, timeout);

    const unsubscribe = useLoadingStore.subscribe(() => {
      if (pending().length) return;

      clearTimeout(timer);
      unsubscribe();
      resolve([]);
    });
  });
}

export const useTransitionStore = create<TransitionStore>()((set, get) => ({
  async begin(config, hooks = {}) {
    get().cancel();

    const run = ++token;
    const ids = trajectorySounds(config);

    const sound = useSoundStore.getState();
    sound.prepareMix(ids);
    sound.play();

    set({
      config,
      ids,
      mix: {},
      position: config.start,
      status: 'loading',
      t: 0,
    });

    const loadStarted = performance.now();
    const missing = await waitForSounds(ids, LOAD_TIMEOUT);

    if (run !== token) return false;

    hooks.onReady?.({ loadMs: performance.now() - loadStarted, missing });
    set({ status: 'running' });

    handle = runTransition({
      ...config,
      ids,
      onComplete() {
        detach();
        useSoundStore.getState().releaseSilent(ids);
        set({ status: 'complete' });
        hooks.onComplete?.();
      },
      onTick(state) {
        set({ mix: state.mix, position: state.position, t: state.t });
        hooks.onTick?.(state);
      },
      setVolumes: volumes => useSoundStore.getState().setVolumes(volumes),
    });

    // a zero-length run completes inside runTransition()
    if (get().status !== 'running') return true;

    unsubscribeSound = useSoundStore.subscribe((state, prev) => {
      // the path's clock follows the global play/pause button
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) handle?.resume();
        else handle?.pause();
      }

      // "unselect all" mid-run means the listener has abandoned the path
      if (ids.every(id => !state.sounds[id]?.isSelected)) get().cancel();
    });

    if (!useSoundStore.getState().isPlaying) handle?.pause();

    return true;
  },

  cancel() {
    token++;
    detach();

    const { ids, status } = get();

    if (status === 'loading' || status === 'running') {
      useSoundStore.getState().releaseSilent(ids);
    }

    set({ mix: {}, position: null, status: 'idle', t: 0 });
  },

  config: null,
  ids: [],
  mix: {},
  position: null,
  status: 'idle',
  t: 0,
}));
