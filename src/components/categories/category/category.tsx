import { Sounds } from '@/components/sounds';

import styles from './category.module.css';

import type { Category } from '@/data/types';

interface CategoryProps extends Category {
  functional?: boolean;
}

export function Category({
  functional = true,
  icon,
  id,
  sounds,
  title,
}: CategoryProps) {
  return (
    <div className={styles.category} id={`category-${id}`}>
      <div className={styles.heading}>
        <div aria-hidden="true" className={styles.icon}>
          {icon}
        </div>
        <h2 className={styles.title}>{title}</h2>
      </div>
      <Sounds functional={functional} id={id} sounds={sounds} />
    </div>
  );
}
