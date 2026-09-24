import { TbRoute } from 'react-icons/tb/index';

import { useTransitionStore } from '@/stores/transition';
import { Item } from '../item';

interface TransitionProps {
  open: () => void;
}

export function Transition({ open }: TransitionProps) {
  const status = useTransitionStore(state => state.status);

  return (
    <Item
      active={status === 'loading' || status === 'running'}
      icon={<TbRoute />}
      label="Mood Transition"
      shortcut="Shift + Alt + M"
      onClick={open}
    />
  );
}
