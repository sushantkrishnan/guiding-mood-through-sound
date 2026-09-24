import { create } from 'zustand';

interface StudyStore {
  /**
   * A study session or the visualiser is in progress. Hides the app's own
   * chrome — toolbar, donation prompts, marketing copy, favourites — so the
   * unguided condition shows participants the mixer and nothing else.
   */
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useStudyStore = create<StudyStore>()(set => ({
  active: false,
  setActive(active) {
    // Astro-rendered sections are hidden by CSS (global.css, .study-hide)
    if (active) document.documentElement.dataset.study = '';
    else delete document.documentElement.dataset.study;

    set({ active });
  },
}));
