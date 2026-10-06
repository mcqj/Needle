/**
 * Needle's Worker: the app, and the artwork host.
 *
 * The built frontend is served as static assets, which are free and unlimited.
 * Only these paths reach this script (see `run_worker_first` in wrangler.toml):
 *
 *   /upload    store an image
 *   /i/<key>   serve a stored image
 *   /health    report on both bindings
 *
 * Uploaded images are content-addressed by the SHA-256 of their bytes, so
 * re-uploading the same picture is idempotent and a key's URL never changes.
 * That is what makes a one-year immutable cache safe.
 *
 * Because the app and the images share an origin, stored URLs are relative
 * (`/i/<key>`) and no CORS configuration is involved.
 */

/** Extensions chosen per content type, so a stored object is self-describing. */
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Where stored images are served from. Mirrors run_worker_first. */
const IMAGE_PREFIX = '/i/';

const KEY_PATTERN = /^[a-f0-9]{16,64}\.[a-z0-9]{2,5}$/;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * May this request write?
 *
 * Uploading is a write, so it is not open to the internet. A same-origin
 * request is allowed by construction: it came from the page this Worker served,
 * and a page cannot forge `Origin`, so a cross-site script cannot produce a
 * matching one. That also means no list to keep in step as hostnames change.
 *
 * Configured origins cover development, where Vite serves the app on another
 * port and proxies here; a token covers callers that have no Origin at all,
 * which is what CORS alone could never achieve.
 */
function mayUpload(request, env) {
  const token = request.headers.get('X-Upload-Token');
  const expectedToken = env.UPLOAD_TOKEN;
  const tokenAllowed = Boolean(expectedToken) && token === expectedToken;

  const origin = request.headers.get('Origin');
  if (!origin) return tokenAllowed;

  // Compare against this request's own host. `url.host` includes any port, which
  // keeps the check honest in local development where the Worker runs on 8787.
  try {
    const sameOrigin = new URL(origin).host === new URL(request.url).host;
    return sameOrigin || allowedOrigins(env).includes(origin) || tokenAllowed;
  } catch {
    return tokenAllowed;
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** The relative URL the app stores in an entry. */
function publicUrl(env, request, key) {
  const base = String(env.PUBLIC_BASE || '').replace(/\/$/, '');
  const path = `${IMAGE_PREFIX}${key}`;
  // Empty by default: a relative URL resolves against whichever host served the
  // app, so entries are not pinned to one hostname.
  return base ? `${base}${path}` : path;
}

async function upload(request, env) {
  const maxBytes = Number(env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_BYTES;
  const bucket = env.ASSETS_R2;

  if (!mayUpload(request, env)) {
    return json({ error: 'Uploads are only accepted from this app.' }, 403);
  }

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength && declaredLength > maxBytes) {
    return json({ error: `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` }, 413);
  }

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  // The stored type is written to the object and sent back on read, so it must
  // be one we chose. Never trust the uploader's string verbatim.
  if (!EXTENSIONS[contentType]) {
    return json({ error: 'Choose a PNG, JPEG, WebP, GIF or AVIF image.' }, 415);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return json({ error: 'That file was empty.' }, 400);
  }
  if (bytes.byteLength > maxBytes) {
    return json({ error: `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` }, 413);
  }

  // Content addressing: identical bytes give an identical key, so the same
  // picture uploaded twice stores once and the URL stays stable.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  const key = `${hash}.${EXTENSIONS[contentType]}`;

  const existing = await bucket.head(key);
  if (!existing) {
    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  return json({
    key,
    url: publicUrl(env, request, key),
    bytes: bytes.byteLength,
    deduplicated: Boolean(existing),
  }, 200);
}

async function serveImage(key, request, env) {
  // A key that is not content-addressed is not ours: answer 404 rather than
  // falling through, so a missing image never becomes the SPA's HTML.
  if (!KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.ASSETS_R2.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  // The bytes for a key never change, so a matching ETag means the client's
  // copy is still correct.
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

/** Report on what this deployment can actually reach. */
async function health(env) {
  let imageCount = 'unknown';
  let imagesOk = true;
  try {
    const listing = await env.ASSETS_R2.list({ limit: 1 });
    imageCount = listing.truncated ? '1+' : listing.objects.length;
  } catch {
    imagesOk = false;
  }

  const appOk = Boolean(env.ASSETS);
  return json({
    ok: imagesOk && appOk,
    app: appOk ? 'assets bound' : 'assets missing',
    images: imagesOk ? `r2 reachable (${imageCount} sampled)` : 'r2 unreachable',
  }, imagesOk && appOk ? 200 : 503);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Nothing here is cross-origin any more, so no CORS headers are needed.
    // Preflight is answered anyway: it costs nothing, and it keeps uploads
    // working if this Worker is ever served under a separate origin.
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      const headers = allowedOrigins(env).includes(origin)
        ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
        : {};
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/health') {
      return health(env);
    }

    if (url.pathname === '/upload') {
      if (request.method !== 'PUT' && request.method !== 'POST') {
        return json({ error: 'Use PUT to upload.' }, 405);
      }
      try {
        return await upload(request, env);
      } catch (error) {
        return json({ error: `Upload failed: ${error.message}` }, 500);
      }
    }

    if (url.pathname.startsWith(IMAGE_PREFIX)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
      }
      return serveImage(url.pathname.slice(IMAGE_PREFIX.length), request, env);
    }

    // Anything else here was not matched by an asset and was not the SPA
    // fallback, so let the asset router decide (it applies not_found_handling).
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Not found', { status: 404 });
  },
};
