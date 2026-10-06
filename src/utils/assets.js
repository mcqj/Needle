/**
 * Artwork uploads.
 *
 * Uploaded images go to the asset Worker and only the returned URL is stored in
 * the entry, so browser storage stays small and the picture is not trapped on
 * one device. If the asset endpoint is not configured or cannot be reached, the
 * image is embedded as a data URL instead: the ledger must keep working without
 * a backend, exactly as it does without the relay.
 */
import { fileToDataUrl } from './media';

/** A value meaning "do not upload": images are embedded in the entry instead. */
export const ASSETS_OFF = 'off';

/**
 * Where uploads go.
 *
 * Production: the app, its images and the upload endpoint are all served by one
 * Worker, so uploads are same-origin at `/upload`, and an empty prefix is the
 * right answer. There is nothing to configure.
 *
 * Development: Vite serves the app and proxies `/api/*` and `/i/*` to the Worker
 * running separately, so the app is same-origin there too and the same relative
 * URLs work. The prefix exists only so the proxy can distinguish the Worker's
 * paths from Vite's own.
 *
 * VITE_ASSET_ENDPOINT overrides both: an absolute URL if the asset API is ever
 * served elsewhere, or `off` to opt out of uploads entirely.
 */
function resolveEndpoint() {
  const configured = import.meta.env?.VITE_ASSET_ENDPOINT;
  if (configured === ASSETS_OFF) return ASSETS_OFF;
  if (configured !== undefined) return configured;
  return import.meta.env?.DEV ? '/api' : '';
}

export const ASSET_ENDPOINT = resolveEndpoint().replace(/\/$/, '');

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/**
 * Whether uploads are available at all. An empty endpoint is *not* "off": it
 * means same-origin, which is how the deployed app is served.
 */
export function isAssetHostConfigured() {
  return ASSET_ENDPOINT !== ASSETS_OFF;
}

/**
 * Check a file before any network work, so the user hears about a problem
 * immediately rather than after an upload attempt.
 */
export function validateImageFile(file) {
  if (!file) return 'Choose an image file.';
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Choose a PNG, JPEG, WebP, GIF or AVIF image.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Choose an image smaller than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
  }
  return '';
}

/**
 * Upload one image and resolve to the URL to store in the entry.
 *
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress] 0..1 while the bytes go up.
 * @returns {Promise<{ url: string, stored: 'asset-host' | 'embedded' }>}
 */
export async function uploadArtwork(file, onProgress) {
  if (!isAssetHostConfigured()) {
    return { url: await fileToDataUrl(file), stored: 'embedded' };
  }

  try {
    const response = await send(file, onProgress);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `The image host refused the upload (${response.status}).`);
    }
    const body = await response.json();
    if (!body.url) throw new Error('The image host did not return a URL.');
    return { url: body.url, stored: 'asset-host' };
  } catch (error) {
    // A refused upload is worth surfacing; a missing host is not a failure the
    // user should have to care about, so small images still work offline.
    if (error?.name === 'AssetHostUnreachable' && file.size <= 2 * 1024 * 1024) {
      return { url: await fileToDataUrl(file), stored: 'embedded' };
    }
    throw error;
  }
}

/**
 * XHR rather than fetch, because upload progress needs it and images can be a
 * few megabytes.
 */
function send(file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `${ASSET_ENDPOINT}/upload`);
    request.setRequestHeader('Content-Type', file.type);

    request.upload?.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });

    request.addEventListener('load', () => resolve({
      ok: request.status >= 200 && request.status < 300,
      status: request.status,
      json: async () => JSON.parse(request.responseText),
    }));

    request.addEventListener('error', () => {
      const error = new Error('The image host could not be reached.');
      error.name = 'AssetHostUnreachable';
      reject(error);
    });

    request.send(file);
  });
}
