import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const IDENTITY_FILE = fileURLToPath(new URL('./.relay-jmq.json', import.meta.url));

// Dev only. The identity file is a secret held in the project directory, never
// bundled and never committed. This serves it to the local dev origin so the
// app can seed its own credential store on first run instead of asking the
// user to hand-copy a dotfile. The endpoint does not exist in a build.
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
        res.end(readFileSync(IDENTITY_FILE));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), relayIdentityEndpoint()],
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
