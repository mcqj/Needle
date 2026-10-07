import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only. The identity file is a secret held in the project directory, never
// bundled and never committed. This serves it to the local dev origin so the
// app can seed its own credential store on first run instead of asking the
// user to hand-copy a dotfile. The endpoint does not exist in a build.
const IDENTITY_FILE = fileURLToPath(new URL('./.relay-jmq.json', import.meta.url));

/**
 * The filename is returned in a header because the exported credentials do not
 * carry the handle: per the integration spec it lives in `.relay-<handle>.json`,
 * so the app reads it from the name rather than being configured with it. To use
 * a different handle, drop `.relay-<that handle>.json` in the project root and
 * change the path above; nothing in the app needs editing.
 */
function relayIdentityEndpoint() {
  return {
    name: 'needle:relay-identity',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/.relay-identity', (req, res) => {
        if (!existsSync(IDENTITY_FILE)) {
          res.statusCode = 404;
          res.end('no identity file');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-identity-file', basename(IDENTITY_FILE));
        res.end(readFileSync(IDENTITY_FILE));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), relayIdentityEndpoint()],
  server: {
    proxy: {
      // Dev only: `npm run assets:dev` runs the Worker against a local R2
      // bucket. Both of the Worker's own path prefixes are proxied so the app is
      // same-origin locally, exactly as it is when deployed — the Worker's
      // `run_worker_first` covers /i/* in production, and without this the dev
      // server's SPA fallback would answer an image request with index.html.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/i': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/tests/**', 'src/features/friends/relay-client.js'],
    },
  },
});
