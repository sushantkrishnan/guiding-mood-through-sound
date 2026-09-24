/**
 * Writes one participant-session into its SessionLog: timestamped events,
 * the listening trace, and the behavioural measures (pauses, volume and
 * mixer changes, tab switches). Kept apart from the React components so the
 * session screens only decide what to show.
 */

import type { AffectPoint } from '@/lib/affect';
import { traceRow, type SessionLog } from '@/lib/study';
import { useSettingsStore } from '@/stores/settings';
import { useSoundStore } from '@/stores/sound';

/** a slider drag is one change, logged once it settles */
const SETTLE_MS = 400;

export class Recorder {
  readonly log: SessionLog;

  private readonly began = performance.now();
  private last: {
    elapsed: number;
    mix: Record<string, number>;
    position: AffectPoint | null;
  } | null = null;
  private lastRow = Number.NEGATIVE_INFINITY;
  private teardown: Array<() => void> = [];

  constructor(log: SessionLog) {
    this.log = log;
  }

  /** ms since the researcher started the session */
  now() {
    return Math.round(performance.now() - this.began);
  }

  event(type: string, data: Record<string, unknown> = {}) {
    this.log.events.push({ t: this.now(), type, ...data });
  }

  /**
   * One engine tick. Rows are kept at the log's trace rate: a guided run
   * replays exactly from its route, so 20 rows a second only cost storage.
   */
  tick(
    elapsed: number,
    position: AffectPoint | null,
    mix: Record<string, number>,
  ) {
    this.last = { elapsed, mix, position };

    if (elapsed - this.lastRow >= 1000 / this.log.config.traceRate) {
      this.log.trace.push(traceRow(elapsed, position, mix));
      this.lastRow = elapsed;
    }
  }

  /** Keep the final state even if it fell between trace rows. */
  flushTrace() {
    if (this.last && this.last.elapsed > this.lastRow) {
      const { elapsed, mix, position } = this.last;
      this.log.trace.push(traceRow(elapsed, position, mix));
      this.lastRow = elapsed;
    }
  }

  /** Log pauses, global volume changes and tab switches while listening. */
  watchBehaviour() {
    const { summary } = this.log;

    const unsubscribePlay = useSoundStore.subscribe((state, prev) => {
      if (state.isPlaying === prev.isPlaying) return;
      if (state.isPlaying) return this.event('play');

      // Moodist pauses by itself whenever nothing is selected; only a pause
      // with sounds still selected is the participant's own
      const auto = state.noSelected();
      if (!auto) summary.pauses++;

      this.event('pause', { auto });
    });

    let volumeTimer: ReturnType<typeof setTimeout> | null = null;
    const flushVolume = () => {
      volumeTimer = null;
      summary.volumeChanges++;
      this.event('volume', {
        value: useSettingsStore.getState().globalVolume,
      });
    };
    const unsubscribeVolume = useSettingsStore.subscribe((state, prev) => {
      if (state.globalVolume === prev.globalVolume) return;
      if (volumeTimer) clearTimeout(volumeTimer);

      volumeTimer = setTimeout(flushVolume, SETTLE_MS);
    });

    const onVisibility = () =>
      this.event('visibility', { hidden: document.hidden });
    document.addEventListener('visibilitychange', onVisibility);

    this.onStop(() => {
      unsubscribePlay();
      unsubscribeVolume();
      document.removeEventListener('visibilitychange', onVisibility);

      if (volumeTimer) {
        clearTimeout(volumeTimer);
        flushVolume();
      }
    });
  }

  /**
   * Unguided listening: log every selection and (settled) volume change the
   * participant makes in the mixer, so their mix can be rebuilt exactly
   * rather than only sampled by the trace.
   */
  watchMixer() {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const flush = (id: string) => {
      timers.delete(id);
      this.log.summary.mixerChanges++;
      this.event('mixer', {
        id,
        volume: useSoundStore.getState().sounds[id]?.volume,
      });
    };

    const unsubscribe = useSoundStore.subscribe((state, prev) => {
      if (state.sounds === prev.sounds) return;

      Object.keys(state.sounds).forEach(id => {
        const now = state.sounds[id];
        const before = prev.sounds[id];

        if (!before) return;

        if (now.isSelected !== before.isSelected) {
          this.log.summary.mixerChanges++;
          this.event('mixer', {
            id,
            selected: now.isSelected,
            volume: now.volume,
          });
        } else if (now.volume !== before.volume && now.isSelected) {
          const pending = timers.get(id);
          if (pending) clearTimeout(pending);
          timers.set(
            id,
            setTimeout(() => flush(id), SETTLE_MS),
          );
        }
      });
    });

    this.onStop(() => {
      unsubscribe();
      [...timers.keys()].forEach(id => {
        clearTimeout(timers.get(id));
        flush(id);
      });
    });
  }

  onStop(fn: () => void) {
    this.teardown.push(fn);
  }

  /** Stop every watcher and clock this recorder started. */
  stop() {
    const fns = this.teardown;
    this.teardown = [];
    fns.forEach(fn => {
      fn();
    });
  }
}
