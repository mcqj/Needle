/**
 * Runs the Worker locally with a real R2 bucket and the built frontend, without
 * the wrangler CLI.
 *
 * The app itself is developed against Vite (`npm run dev`), which proxies the
 * asset API here. This server is for checking the Worker's own routing — the
 * upload endpoint, image serving, and the SPA fallback — the way production
 * behaves, with `wrangler dev` as the alternative once you have an account.
 *
 *   npm run build && npm run assets:dev    # then open http://127.0.0.1:8787
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BUCKET_DIR = join(here, '..', '.wrangler', 'r2', 'needle-assets');
const DIST_DIR = join(here, '..', '..', 'dist');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The static-assets binding, approximated: files from the build, with the SPA
 * fallback that `not_found_handling = "single-page-application"` provides in
 * production. Assets are matched first, exactly as Workers does.
 */
const assetsBinding = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    // normalize() collapses any traversal before it touches the filesystem.
    const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
    const candidate = join(DIST_DIR, relative);

    if (relative && candidate.startsWith(DIST_DIR) && existsSync(candidate) && !relative.endsWith('/')) {
      const body = readFileSync(candidate);
      return new Response(body, {
        headers: { 'Content-Type': CONTENT_TYPES[extname(candidate)] ?? 'application/octet-stream' },
      });
    }

    const shell = join(DIST_DIR, 'index.html');
    if (existsSync(shell)) {
      return new Response(readFileSync(shell), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('Build the app first: npm run build', { status: 404 });
  },
};

/**
 * A minimal stand-in for the R2 binding, backed by files on disk so objects
 * survive restarts the way a real bucket does. `r2Metadata` records the HTTP
 * metadata (content type, cache control) alongside the bytes.
 */
function diskBucket(directory) {
  mkdirSync(directory, { recursive: true });

  const paths = (key) => ({ body: join(directory, key), meta: join(directory, `${key}.json`) });

  return {
    async head(key) {
      const { body, meta } = paths(key);
      if (!existsSync(body)) return null;
      const bytes = readFileSync(body);
      return { key, size: bytes.byteLength, httpEtag: `"${key}"`, ...readMeta(meta) };
    },
    async put(key, value, options = {}) {
      const { body, meta } = paths(key);
      writeFileSync(body, value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer()));
      writeFileSync(meta, JSON.stringify(options.httpMetadata ?? {}));
    },
    async list({ limit = 1000 } = {}) {
      const keys = existsSync(directory)
        ? readdirSync(directory).filter((name) => !name.endsWith('.json'))
        : [];
      return {
        objects: keys.slice(0, limit).map((key) => ({ key, size: readFileSync(join(directory, key)).byteLength })),
        truncated: keys.length > limit,
      };
    },
    async get(key) {
      const { body, meta } = paths(key);
      if (!existsSync(body)) return null;
      const bytes = readFileSync(body);
      const httpMetadata = readMeta(meta);
      return {
        body: bytes,
        httpEtag: `"${key}"`,
        writeHttpMetadata(headers) {
          for (const [name, value] of Object.entries(httpMetadata)) {
            headers.set(name.replace(/([A-Z])/g, '-$1').toLowerCase(), String(value));
          }
        },
      };
    },
  };
}

function readMeta(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

const env = {
  ASSETS_R2: diskBucket(BUCKET_DIR),
  ASSETS: assetsBinding,
  ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173',
  // Empty on purpose: stored image URLs are relative, so they resolve against
  // whichever origin served the app rather than baking in a hostname.
  PUBLIC_BASE: '',
  MAX_UPLOAD_BYTES: String(5 * 1024 * 1024),
};

const portArg = process.argv.indexOf('--port');
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 8787);

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });

  try {
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, () => {
  console.log(`needle worker + assets on http://127.0.0.1:${port}`);
  console.log(`bucket: ${BUCKET_DIR}`);
  console.log(`app:    ${DIST_DIR}${existsSync(join(DIST_DIR, 'index.html')) ? '' : '  (not built yet — run npm run build)'}`);
});
