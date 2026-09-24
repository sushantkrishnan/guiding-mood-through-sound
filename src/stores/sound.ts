import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import merge from 'deepmerge';

import { sounds as soundCategories } from '@/data/sounds';
import { pickMany, random } from '@/helpers/random';

type SoundValue = {
  isFavorite: boolean;
  isSelected: boolean;
  volume: number;
};

interface SoundStore {
  getFavorites: () => Array<string>;
  history: Record<string, SoundValue> | null;
  isPlaying: boolean;
  lock: () => void;
  locked: boolean;
  noSelected: () => boolean;
  override: (sounds: Record<string, number>) => void;
  pause: () => void;
  play: () => void;
  commitMix: (ids: Array<string>, gains: Record<string, number>) => void;
  prepareMix: (ids: Array<string>) => void;
  restoreHistory: () => void;
  select: (id: string) => void;
  setVolume: (id: string, volume: number) => void;
  shuffle: () => void;
  sounds: Record<string, SoundValue>;
  toggleFavorite: (id: string) => void;
  togglePlay: () => void;
  unlock: () => void;
  unselect: (id: string) => void;
  unselectAll: (pushToHistory?: boolean) => void;
}

function createInitialSounds() {
  const initialSounds: Record<string, SoundValue> = {};

  soundCategories.categories.forEach(category => {
    category.sounds.forEach(sound => {
      initialSounds[sound.id] = {
        isFavorite: false,
        isSelected: false,
        volume: 0.5,
      };
    });
  });

  return initialSounds;
}

export const useSoundStore = create<SoundStore>()(
  persist(
    (set, get) => ({
      getFavorites() {
        const { sounds } = get();
        const ids = Object.keys(sounds);
        const favorites = ids.filter(id => sounds[id].isFavorite);

        return favorites;
      },

      history: null,
      isPlaying: false,

      lock() {
        set({ locked: true });
      },

      locked: false,

      noSelected() {
        const { sounds } = get();
        const keys = Object.keys(sounds);

        return keys.every(key => !sounds[key].isSelected);
      },

      override(newSounds) {
        get().unselectAll();

        const sounds = get().sounds;

        Object.keys(newSounds).forEach(sound => {
          if (sounds[sound]) {
            sounds[sound].isSelected = true;
            sounds[sound].volume = newSounds[sound];
          }
        });

        set({ history: null, sounds: { ...sounds } });
      },

      pause() {
        set({ isPlaying: false });
      },

      play() {
        set({ isPlaying: true });
      },

      /**
       * Hand a code-driven mix (see stores/mix.ts) back to the listener, in
       * one update: each of `ids` still audible keeps playing at its gain as
       * its own volume; silent ones are deselected at the default volume.
       */
      commitMix(ids, gains) {
        const sounds = { ...get().sounds };

        ids.forEach(id => {
          if (!sounds[id]) return;

          const gain = gains[id] ?? 0;

          sounds[id] =
            gain > 0
              ? { ...sounds[id], volume: gain }
              : { ...sounds[id], isSelected: false, volume: 0.5 };
        });

        set({ sounds });
      },

      /**
       * Select exactly `ids` at volume 0 and deselect everything else, in one
       * update. Used by the transition engine before a run so every sound on
       * the trajectory starts loading and sits silent until its first tick.
       * Per-tick gains then go to the mix store, not here.
       */
      prepareMix(ids) {
        const sounds = get().sounds;
        const next: Record<string, SoundValue> = {};

        Object.keys(sounds).forEach(id => {
          const inMix = ids.includes(id);

          next[id] = {
            ...sounds[id],
            isSelected: inMix,
            volume: inMix ? 0 : 0.5,
          };
        });

        set({ history: null, sounds: next });
      },

      restoreHistory() {
        const history = get().history;

        if (!history) return;

        set({ history: null, sounds: history });
      },

      select(id) {
        set({
          history: null,
          sounds: {
            ...get().sounds,
            [id]: { ...get().sounds[id], isSelected: true },
          },
        });
      },

      setVolume(id, volume) {
        set({
          sounds: {
            ...get().sounds,
            [id]: { ...get().sounds[id], volume },
          },
        });
      },

      shuffle() {
        const sounds = get().sounds;
        const ids = Object.keys(sounds);

        ids.forEach(id => {
          sounds[id].isSelected = false;
          sounds[id].volume = 0.5;
        });

        const randomIDs = pickMany(ids, 4);

        randomIDs.forEach(id => {
          sounds[id].isSelected = true;
          sounds[id].volume = random(0.2, 1);
        });

        set({ history: null, isPlaying: true, sounds });
      },

      sounds: createInitialSounds(),

      toggleFavorite(id) {
        const sounds = get().sounds;
        const sound = sounds[id];

        set({
          history: null,
          sounds: {
            ...sounds,
            [id]: { ...sound, isFavorite: !sound.isFavorite },
          },
        });
      },

      togglePlay() {
        set({ isPlaying: !get().isPlaying });
      },

      unlock() {
        set({ locked: false });
      },

      unselect(id) {
        set({
          sounds: {
            ...get().sounds,
            [id]: { ...get().sounds[id], isSelected: false },
          },
        });
      },

      unselectAll(pushToHistory = false) {
        const noSelected = get().noSelected();

        if (noSelected) return;

        const sounds = get().sounds;

        if (pushToHistory) {
          const history = JSON.parse(JSON.stringify(sounds));
          set({ history });
        }

        const ids = Object.keys(sounds);

        ids.forEach(id => {
          sounds[id].isSelected = false;
          sounds[id].volume = 0.5;
        });

        set({ sounds });
      },
    }),
    {
      merge: (persisted, current) =>
        merge(
          current,
          // @ts-expect-error
          persisted,
        ),
      name: 'moodist-sounds',
      partialize: state => ({
        sounds: state.sounds,
      }),
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      version: 0,
    },
  ),
);
