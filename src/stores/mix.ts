import { create } from 'zustand';

/**
 * Gains driven from code rather than by the listener: the transition engine,
 * the visualiser's playback, and the study's sound-rating block. A selected
 * sound listed here plays at this gain instead of its own volume.
 *
 * Kept out of the sound store on purpose. That store is persisted to
 * localStorage on every change, and the engine writes 20 times a second:
 * it would mean 20 synchronous storage writes a second, and a reload
 * mid-run would restore a half-finished mix.
 */
interface MixStore {
  clear: () => void;
  gains: Record<string, number>;
  setGains: (gains: Record<string, number>) => void;
}

export const useMixStore = create<MixStore>()(set => ({
  clear() {
    set({ gains: {} });
  },

  gains: {},

  setGains(gains) {
    set({ gains });
  },
}));
