import { Howler } from 'howler';

/**
 * A soft two-note chime, so a participant listening with their eyes closed
 * knows a check-in is waiting on screen. Played straight to the output, not
 * through any sound's gain, at the app's global volume.
 */
export function chime(volume = 1) {
  const ctx = Howler.ctx;

  if (!ctx || volume <= 0) return;

  const now = ctx.currentTime;

  [660, 880].forEach((frequency, i) => {
    const start = now + i * 0.18;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12 * volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 1.3);
  });
}
