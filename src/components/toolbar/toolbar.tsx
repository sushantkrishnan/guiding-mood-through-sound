import { Container } from '@/components/container';
import { ScrollToTop } from './scroll-to-top';
import { useStudyStore } from '@/stores/study';

import styles from './toolbar.module.css';

export function Toolbar() {
  const studyActive = useStudyStore(state => state.active);

  if (studyActive) return null;

  return (
    <div className={styles.wrapper}>
      <Container className={styles.container} wide>
        <ScrollToTop />
      </Container>
    </div>
  );
}
