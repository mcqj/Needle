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

/**
 * Where uploads go.
 *
 *   unset  → `/api/assets`, which the Vite dev server proxies to the local
 *            Worker, so development uses a real bucket
 *   ""     → no asset host: images are embedded as data URLs instead
 *   URL    → that host, e.g. https://needle-assets.example.workers.dev
 *
 * A build with no value falls back to the dev path, which will not exist in
 * production — so set VITE_ASSET_ENDPOINT (or an absolute VITE_ASSET_HOST) for
 * a deployed app, and leave it empty to opt out of uploads entirely.
 */
export const ASSET_ENDPOINT = (
  import.meta.env?.VITE_ASSET_ENDPOINT ?? '/api/assets'
).replace(/\/$/, '');

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export function isAssetHostConfigured() {
  return Boolean(ASSET_ENDPOINT);
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
