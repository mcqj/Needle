/**
 * Runs the Worker locally with a real R2 bucket, without the wrangler CLI.
 *
 * `wrangler dev` is the normal way to do this, and is what to use once you have
 * a Cloudflare account. This exists so the app can be developed and verified
 * against a real bucket even before an account exists — and because the CLI
 * insists on writing state outside the project directory.
 *
 *   node worker/dev/dev-server.js [--port 8787]
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BUCKET_DIR = join(here, '..', '.wrangler', 'r2', 'needle-assets');

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
  ASSETS: diskBucket(BUCKET_DIR),
  ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173',
  // Relative to the app origin, which the Vite dev proxy forwards here. Storing
  // an absolute 127.0.0.1 URL in an entry would bake this machine into the data.
  PUBLIC_BASE: '/api/assets',
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
  console.log(`assets worker (local R2) on http://127.0.0.1:${port}`);
  console.log(`bucket: ${BUCKET_DIR}`);
});
