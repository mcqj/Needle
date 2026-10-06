import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_ENDPOINT,
  MAX_UPLOAD_BYTES,
  isAssetHostConfigured,
  uploadArtwork,
  validateImageFile,
} from './assets';

/**
 * A stand-in for XMLHttpRequest. jsdom has one, but driving it needs a real
 * server round trip; this lets each outcome (accepted, refused, host down) be
 * produced directly.
 */
class FakeXhr {
  static instances = [];

  constructor() {
    this.upload = { addEventListener: (name, handler) => { this.uploadHandler = name === 'progress' ? handler : this.uploadHandler; } };
    this.listeners = {};
    FakeXhr.instances.push(this);
  }

  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers = { ...this.headers, [name]: value }; }
  send(body) { this.body = body; }

  addEventListener(name, handler) { this.listeners[name] = handler; }

  // --- test controls ---
  resolve({ status = 200, responseText = '{}' } = {}) {
    this.status = status;
    this.responseText = responseText;
    this.listeners.load?.();
  }

  fail() { this.listeners.error?.(); }

  emitProgress(loaded, total) { this.uploadHandler?.({ lengthComputable: true, loaded, total }); }
}

function pngFile(bytes = 16, name = 'cover.png') {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

function fileOfSize(size, type = 'image/png') {
  return new File([new Uint8Array(size)], 'big.png', { type });
}

describe('asset uploads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXhr.instances = [];
  });

  describe('validateImageFile', () => {
    it('accepts the formats the host stores', () => {
      for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
        expect(validateImageFile(fileOfSize(10, type))).toBe('');
      }
    });

    it('refuses a type the host will not store, before any network work', () => {
      expect(validateImageFile(fileOfSize(10, 'image/svg+xml'))).toMatch(/PNG, JPEG, WebP, GIF or AVIF/);
      expect(validateImageFile(fileOfSize(10, 'text/html'))).toMatch(/PNG, JPEG, WebP, GIF or AVIF/);
    });

    it('refuses a file over the limit', () => {
      expect(validateImageFile(fileOfSize(MAX_UPLOAD_BYTES + 1))).toMatch(/smaller than 5 MB/);
    });

    it('asks for a file when none was chosen', () => {
      expect(validateImageFile(null)).toMatch(/Choose an image file/);
    });
  });

  describe('uploadArtwork', () => {
    it('PUTs the bytes and returns the URL to store in the entry', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      const pending = uploadArtwork(pngFile());

      const xhr = FakeXhr.instances[0];
      expect(xhr.method).toBe('PUT');
      expect(xhr.url).toBe(`${ASSET_ENDPOINT}/upload`);
      expect(xhr.headers['Content-Type']).toBe('image/png');
      expect(xhr.body).toBeInstanceOf(File);

      xhr.resolve({ responseText: JSON.stringify({ url: 'https://assets.example/abc.png', bytes: 16 }) });

      await expect(pending).resolves.toEqual({
        url: 'https://assets.example/abc.png',
        stored: 'asset-host',
      });
    });

    it('reports progress while the bytes go up', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      const seen = [];
      const pending = uploadArtwork(pngFile(), (fraction) => seen.push(fraction));

      const xhr = FakeXhr.instances[0];
      xhr.emitProgress(50, 100);
      xhr.emitProgress(100, 100);
      xhr.resolve({ responseText: JSON.stringify({ url: 'https://assets.example/abc.png' }) });
      await pending;

      expect(seen).toEqual([0.5, 1]);
    });

    it('surfaces the host’s own reason for refusing', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      const pending = uploadArtwork(pngFile());
      FakeXhr.instances[0].resolve({
        status: 415,
        responseText: JSON.stringify({ error: 'Choose a PNG, JPEG, WebP, GIF or AVIF image.' }),
      });

      await expect(pending).rejects.toThrow(/PNG, JPEG, WebP, GIF or AVIF/);
    });

    it('falls back to embedding a small image when the host cannot be reached', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      const pending = uploadArtwork(pngFile(64));
      FakeXhr.instances[0].fail();

      const result = await pending;
      expect(result.stored).toBe('embedded');
      // The ledger keeps working with no backend, as it does with no relay.
      expect(result.url.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('refuses to embed a large image, which is what the host exists for', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      const pending = uploadArtwork(fileOfSize(3 * 1024 * 1024));
      FakeXhr.instances[0].fail();

      await expect(pending).rejects.toThrow(/could not be reached/);
    });
  });

  it('uploads same-origin, with the dev prefix only where a proxy needs it', () => {
    // In production the Worker serves the app and the upload endpoint, so there
    // is no prefix and no host to configure. In development Vite proxies /api to
    // the Worker, which is why the prefix exists -- but it must never leak into
    // a deployed build, where /api/upload would 405.
    const dev = import.meta.env.DEV;
    expect(ASSET_ENDPOINT).toBe(dev ? '/api' : '');
  });

  it('treats an empty endpoint as same-origin, not as a reason to give up', () => {
    // This is the deployed case, and getting it wrong silently degrades every
    // upload to an embedded data URL instead of failing loudly.
    expect(isAssetHostConfigured()).toBe(true);
  });
});
