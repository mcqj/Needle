import { describe, expect, it, beforeEach } from 'vitest';
import worker from '../index.js';

/**
 * A stand-in for the R2 binding. It mimics only what the Worker uses — head,
 * put and get — so the request/response behaviour can be tested without a
 * Cloudflare account or a running Miniflare instance.
 */
function fakeBucket() {
  const store = new Map();
  return {
    store,
    async head(key) {
      const object = store.get(key);
      if (!object) return null;
      return { key, size: object.bytes.byteLength, httpEtag: `"${key}"` };
    },
    async put(key, value, options) {
      store.set(key, { bytes: new Uint8Array(value), httpMetadata: options?.httpMetadata ?? {} });
    },
    async get(key) {
      const object = store.get(key);
      if (!object) return null;
      return {
        body: object.bytes,
        httpEtag: `"${key}"`,
        // R2 maps camelCase httpMetadata onto the real headers, so the fake
        // must too: contentType becomes Content-Type, cacheControl becomes
        // Cache-Control. Otherwise the test would pass while the deployed
        // Worker served objects with no type at all.
        writeHttpMetadata(headers) {
          for (const [name, value] of Object.entries(object.httpMetadata)) {
            const header = name.replace(/([A-Z])/g, '-$1').toLowerCase();
            headers.set(header, String(value));
          }
        },
      };
    },
  };
}

const ENV = {
  ASSETS: null,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PUBLIC_BASE: '',
  MAX_UPLOAD_BYTES: '1048576',
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function uploadRequest({ body = PNG, type = 'image/png', origin = 'http://localhost:5173', token } = {}) {
  const headers = { 'Content-Type': type };
  if (origin) headers.Origin = origin;
  if (token) headers['X-Upload-Token'] = token;
  return new Request('https://assets.example.com/upload', { method: 'PUT', headers, body });
}

describe('asset worker', () => {
  let env;
  beforeEach(() => { env = { ...ENV, ASSETS: fakeBucket() }; });

  it('stores an image and answers with a URL the app can keep', async () => {
    const response = await worker.fetch(uploadRequest(), env);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toMatch(/^https:\/\/assets\.example\.com\/[a-f0-9]{32}\.png$/);
    expect(body.bytes).toBe(PNG.byteLength);
    expect(body.deduplicated).toBe(false);
    expect(env.ASSETS.store.size).toBe(1);
  });

  it('sets a long-lived cache header, which content addressing makes safe', async () => {
    const { url } = await (await worker.fetch(uploadRequest(), env)).json();
    const key = new URL(url).pathname.slice(1);
    expect(env.ASSETS.store.get(key).httpMetadata.cacheControl)
      .toBe('public, max-age=31536000, immutable');
  });

  it('is idempotent for identical bytes', async () => {
    const first = await (await worker.fetch(uploadRequest(), env)).json();
    const second = await (await worker.fetch(uploadRequest(), env)).json();

    expect(second.key).toBe(first.key);
    expect(second.url).toBe(first.url);
    expect(second.deduplicated).toBe(true);
    expect(env.ASSETS.store.size).toBe(1);
  });

  it('gives different bytes different URLs', async () => {
    const other = new Uint8Array([...PNG, 99]);
    const first = await (await worker.fetch(uploadRequest(), env)).json();
    const second = await (await worker.fetch(uploadRequest({ body: other }), env)).json();
    expect(second.key).not.toBe(first.key);
  });

  it('refuses a type it will not store, rather than trusting the uploader', async () => {
    const response = await worker.fetch(uploadRequest({ type: 'text/html' }), env);
    expect(response.status).toBe(415);
    expect((await response.json()).error).toMatch(/PNG, JPEG, WebP, GIF or AVIF/);
    expect(env.ASSETS.store.size).toBe(0);
  });

  it('refuses a file over the limit, by declared length and by actual size', async () => {
    const declared = new Request('https://assets.example.com/upload', {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': '99999999',
        Origin: 'http://localhost:5173',
      },
      body: PNG,
    });
    expect((await worker.fetch(declared, env)).status).toBe(413);

    const big = new Uint8Array(2 * 1024 * 1024);
    expect((await worker.fetch(uploadRequest({ body: big }), env)).status).toBe(413);
    expect(env.ASSETS.store.size).toBe(0);
  });

  it('rejects an empty file', async () => {
    const response = await worker.fetch(uploadRequest({ body: new Uint8Array(0) }), env);
    expect(response.status).toBe(400);
  });

  it('serves a stored image back with its type and an ETag', async () => {
    const { url } = await (await worker.fetch(uploadRequest(), env)).json();
    const response = await worker.fetch(new Request(url), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await response.arrayBuffer()).toEqual(PNG.buffer);
  });

  it('answers 304 when the client already has the bytes', async () => {
    const { url } = await (await worker.fetch(uploadRequest(), env)).json();
    const etag = (await worker.fetch(new Request(url), env)).headers.get('ETag');
    const conditional = await worker.fetch(new Request(url, { headers: { 'If-None-Match': etag } }), env);
    expect(conditional.status).toBe(304);
  });

  it('404s for a key it does not hold, and for a path that is not a key', async () => {
    expect((await worker.fetch(new Request('https://assets.example.com/deadbeefdeadbeefdeadbeefdeadbeef.png'), env)).status).toBe(404);
    expect((await worker.fetch(new Request('https://assets.example.com/../secrets'), env)).status).toBe(404);
  });

  it('allows the configured origin and stays silent for any other', async () => {
    const allowed = await worker.fetch(uploadRequest(), env);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');

    const other = await worker.fetch(uploadRequest({ origin: 'https://evil.example' }), env);
    expect(other.status).toBe(403);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses an upload that carries no Origin at all, which is how a script would ask', async () => {
    // A browser cannot omit Origin; curl and bots do. CORS alone would have let
    // this through, which is how an open bucket gets filled by someone else.
    const response = await worker.fetch(uploadRequest({ origin: null }), env);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/only accepted from this app/);
    expect(env.ASSETS.store.size).toBe(0);
  });

  it('refuses an upload from an origin the app does not use', async () => {
    const response = await worker.fetch(uploadRequest({ origin: 'https://evil.example' }), env);
    expect(response.status).toBe(403);
    expect(env.ASSETS.store.size).toBe(0);
  });

  it('accepts a token-bearing upload from a caller with no Origin, when a token is configured', async () => {
    const withToken = { ...env, UPLOAD_TOKEN: 's3cret' };
    expect((await worker.fetch(uploadRequest({ origin: null }), withToken)).status).toBe(403);
    expect((await worker.fetch(uploadRequest({ origin: null, token: 'wrong' }), withToken)).status).toBe(403);
    expect((await worker.fetch(uploadRequest({ origin: null, token: 's3cret' }), withToken)).status).toBe(200);
  });

  it('answers preflight', async () => {
    const response = await worker.fetch(new Request('https://assets.example.com/upload', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('uses PUBLIC_BASE for the returned URL when a domain is attached', async () => {
    const withDomain = { ...env, PUBLIC_BASE: 'https://assets.jmq.example/' };
    const { url } = await (await worker.fetch(uploadRequest(), withDomain)).json();
    expect(url).toMatch(/^https:\/\/assets\.jmq\.example\/[a-f0-9]{32}\.png$/);
  });

  it('reports health without touching the bucket', async () => {
    const response = await worker.fetch(new Request('https://assets.example.com/health'), env);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});
