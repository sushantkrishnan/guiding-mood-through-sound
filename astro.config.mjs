import { execSync } from 'node:child_process';

import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import AstroPWA from '@vite-pwa/astro';

// Serve from a sub-path, e.g. BASE_PATH=/moodist-study/ for GitHub Pages.
// Defaults to the site root, which is what upstream Moodist assumes.
const path = (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
const base = path ? `/${path}/` : '/';

// Written into every study log (src/lib/provenance.ts), so a log says which
// code produced it.
const git = args => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const status = git('status --porcelain');
const build = {
  builtAt: new Date().toISOString(),
  commit: git('rev-parse --short HEAD'),
  dirty: status === null ? null : status.length > 0,
};

export default defineConfig({
  base,
  devToolbar: { enabled: false },
  // scripts/pages/publish.sh builds elsewhere so dist/ keeps serving locally
  outDir: process.env.OUT_DIR || './dist',
  vite: {
    define: { __BUILD__: JSON.stringify(build) },
  },
  integrations: [
    react(),
    AstroPWA({
      manifest: {
        background_color: '#09090b',
        description: 'Ambient sounds for focus and calm.',
        display: 'standalone',
        icons: [
          ...[72, 128, 144, 152, 192, 256, 512].map(size => ({
            sizes: `${size}x${size}`,
            src: `${base}assets/pwa/${size}.png`,
            type: 'image/png',
          })),
        ],
        name: 'Moodist',
        orientation: 'any',
        scope: base,
        short_name: 'Moodist',
        start_url: base,
        theme_color: '#09090b',
      },
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*'],
        // research-only sound libraries (scripts/libraries/build.py): large,
        // and only the visualiser uses them
        globIgnores: ['libraries/**'],
        maximumFileSizeToCacheInBytes: Number.MAX_SAFE_INTEGER,
        navigateFallback: base,
      },
    }),
  ],
});
