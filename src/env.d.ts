/// <reference types="astro/client" />
/// <reference types="vite-plugin-pwa/react" />

declare module '*.module.css';

/** Audio Session API (Safari), not yet in TypeScript's DOM types */
interface Navigator {
  audioSession?: {
    type:
      | 'ambient'
      | 'auto'
      | 'play-and-record'
      | 'playback'
      | 'transient'
      | 'transient-solo';
  };
}
