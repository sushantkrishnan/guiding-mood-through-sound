import { create } from 'zustand';

interface StudyStore {
  /** a participant session is in progress; hides the regular app chrome */
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useStudyStore = create<StudyStore>()(set => ({
  active: false,
  setActive(active) {
    set({ active });
  },
}));
