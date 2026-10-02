import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  test: {
    name: 'server:unit',
    root: serverRoot,
    globals: true,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/cores/**', 'src/services/**', 'src/utils/**', 'src/sql-tools/**'],
      exclude: [
        'src/services/*.spec.ts',
        'src/services/api.service.ts',
        'src/services/microservices.service.ts',
        'src/services/index.ts',
      ],
    },
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
    env: {
      TZ: 'UTC',
      // Fork (Google Drive): the feature's config defaults are read from these at module load
      // (config.ts), so any shell that exports them turned the feature on under every spec that
      // assumes the default "off" — 15 tests across five specs failed that way (wave11g review
      // M1). Pinned empty here, once, rather than in each spec: a spec that needs the feature on
      // already says so through its systemMetadata mock.
      IMMICH_GOOGLE_DRIVE_CLIENT_ID: '',
      IMMICH_GOOGLE_DRIVE_CLIENT_SECRET: '',
      IMMICH_GOOGLE_DRIVE_REDIRECT_URL: '',
      IMMICH_GOOGLE_DRIVE_API_KEY: '',
    },
  },
  plugins: [swc.vite(), tsconfigPaths()],
});
