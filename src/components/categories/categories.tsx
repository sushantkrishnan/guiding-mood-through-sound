import { AnimatePresence } from 'motion/react';

import { Category } from './category';
import { Donate } from './donate';

import { useStudyStore } from '@/stores/study';

import type { Categories } from '@/data/types';

interface CategoriesProps {
  categories: Categories;
}

export function Categories({ categories }: CategoriesProps) {
  const studyActive = useStudyStore(state => state.active);

  return (
    <AnimatePresence initial={false}>
      {categories.map((category, index) => (
        <div key={category.id}>
          <Category functional={category.id !== 'favorites'} {...category} />

          {index === 3 && !studyActive && <Donate />}
        </div>
      ))}
    </AnimatePresence>
  );
}
