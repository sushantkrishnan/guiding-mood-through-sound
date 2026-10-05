import { cn } from '@/helpers/styles';

import styles from './container.module.css';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  extraWide?: boolean;
  tight?: boolean;
  wide?: boolean;
}

export function Container({
  children,
  className,
  extraWide,
  tight,
  wide,
}: ContainerProps) {
  return (
    <div
      className={cn(
        styles.container,
        className,
        tight && styles.tight,
        wide && styles.wide,
        extraWide && styles.extraWide,
      )}
    >
      {children}
    </div>
  );
}
