import { useState } from 'react';

import { useSettingsStore } from '@/stores/settings';

import styles from './study.module.css';

interface ListeningProps {
  /** check-ins are announced by a chime */
  chime: boolean;
  /** the session has check-ins at all */
  checkIns: boolean;
  onEnd: () => void;
}

/** The screen while a guided (engine-driven) condition plays. */
export function Listening({ checkIns, chime, onEnd }: ListeningProps) {
  return (
    <div className={styles.page}>
      <p className={styles.calm}>Just listen.</p>
      <p className={styles.lead}>
        You can close your eyes.{' '}
        {checkIns &&
          (chime
            ? 'When you hear a soft chime, open them: a quick question will be on screen. '
            : 'Now and then a quick question will appear on screen. ')}
        You can change the volume at any time.
      </p>
      <Controls onEnd={onEnd} />
    </div>
  );
}

/** Unguided: a bar over the regular mixer instead of a full cover. */
export function UnguidedBar({ onEnd }: { onEnd: () => void }) {
  return (
    <div className={styles.bar}>
      <p>
        <strong>You choose the sounds this time.</strong> Pick and adjust sounds
        below to help you get to how you want to feel.
      </p>
      <Controls onEnd={onEnd} />
    </div>
  );
}

/**
 * Shared by every condition, so the controls themselves are not a cue. No
 * clock: a countdown invites clock-watching, and makes an unchanging
 * session feel longer than a changing one.
 */
function Controls({ onEnd }: { onEnd: () => void }) {
  const volume = useSettingsStore(state => state.globalVolume);
  const setVolume = useSettingsStore(state => state.setGlobalVolume);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={styles.controls}>
      <label className={styles.volume}>
        <span>Volume</span>
        <input
          max={100}
          min={0}
          type="range"
          value={Math.round(volume * 100)}
          onChange={e => setVolume(Number(e.target.value) / 100)}
        />
      </label>

      {confirming ? (
        <span className={styles.confirm}>
          End now?
          <button type="button" onClick={onEnd}>
            Yes, end
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep listening
          </button>
        </span>
      ) : (
        <button
          className={styles.link}
          type="button"
          onClick={() => setConfirming(true)}
        >
          End session early
        </button>
      )}
    </div>
  );
}
