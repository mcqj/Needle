/**
 * Asset hosting for Needle.
 *
 * The app uploads an image here and stores only the returned URL in its entry,
 * instead of embedding megabytes of base64 in browser storage. Objects are
 * content-addressed, so re-uploading the same picture is idempotent and the URL
 * for given bytes never changes — which is what makes a long cache lifetime
 * safe.
 *
 * One endpoint, one bucket. Deploy with `wrangler deploy`; the bucket named in
 * wrangler.toml is created on first deploy.
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

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  // Reflect an allowed origin; otherwise omit the header so the browser blocks
  // it. Never echo an origin that was not configured.
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** A URL the app can store in an entry. */
function publicUrl(env, request, key) {
  const base = String(env.PUBLIC_BASE || '').replace(/\/$/, '');
  if (base) return `${base}/${key}`;
  // No domain attached yet: serve from this Worker's own origin.
  return new URL(`/${key}`, request.url).toString();
}

async function upload(request, env) {
  const maxBytes = Number(env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_BYTES;

  const origin = request.headers.get('Origin');
  const token = request.headers.get('X-Upload-Token');
  const expectedToken = env.UPLOAD_TOKEN;

  // Uploading is a write, so it is not open to the internet. A browser always
  // sends Origin on a cross-origin request and cannot forge it, so demanding an
  // allowed one shuts out scripted abuse; CORS alone only restrains browsers.
  // When UPLOAD_TOKEN is set (wrangler secret put UPLOAD_TOKEN), the same rule
  // applies to server-side callers.
  const originAllowed = Boolean(origin) && allowedOrigins(env).includes(origin);
  const tokenAllowed = Boolean(expectedToken) && token === expectedToken;
  if (!originAllowed && !tokenAllowed) {
    // No CORS header is granted here: an origin that may not upload does not
    // get to read the reason either.
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

  const existing = await env.ASSETS.head(key);
  if (!existing) {
    await env.ASSETS.put(key, bytes, {
      httpMetadata: {
        contentType,
        // Content-addressed, so this is safe and keeps repeat reads cheap.
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

async function serve(key, request, env) {
  if (!/^[a-f0-9]{16,64}\.[a-z0-9]{2,5}$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.ASSETS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Access-Control-Allow-Origin', '*');
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  // The bytes for a key never change, so a matching ETag means the client copy
  // is still correct.
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'needle-assets' }, 200, cors);
    }

    if (url.pathname === '/upload') {
      if (request.method !== 'PUT' && request.method !== 'POST') {
        return json({ error: 'Use PUT to upload.' }, 405, cors);
      }
      try {
        const response = await upload(request, env);
        for (const [name, value] of Object.entries(cors)) {
          if (!response.headers.has(name)) response.headers.set(name, value);
        }
        return response;
      } catch (error) {
        return json({ error: `Upload failed: ${error.message}` }, 500, cors);
      }
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      return serve(url.pathname.slice(1), request, env);
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};
