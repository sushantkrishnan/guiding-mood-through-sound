import { AnimatePresence } from 'motion/react';

import { Category } from './category';

import type { Categories } from '@/data/types';

interface CategoriesProps {
  categories: Categories;
}

export function Categories({ categories }: CategoriesProps) {
  return (
    <AnimatePresence initial={false}>
      {categories.map(category => (
        <div key={category.id}>
          <Category functional={category.id !== 'favorites'} {...category} />
        </div>
      ))}
    </AnimatePresence>
  );
}
