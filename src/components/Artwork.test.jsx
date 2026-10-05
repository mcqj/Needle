import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Artwork from './Artwork';
import { RETRY_DELAYS_MS } from '../utils/artworkRetry';

// jsdom never fires image load events, so the failure paths are driven directly.
// The behaviour under test is what the component does when a saved URL stops
// working: recover on its own if the refusal was temporary, and show a plain
// readable tile if it was not.

/** Fire a failure on the current image element. */
function fail() {
  fireEvent.error(document.querySelector('.artwork img'));
}

/**
 * Let a scheduled retry come due. Async on purpose: React schedules the state
 * update from a timer, so the microtask queue has to drain before asserting.
 * Delays carry up to 25% jitter, which is why callers pass the full delay.
 */
async function advance(ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Fire a failure, let the retry come due, and let React settle. */
async function failThenRetry(delay) {
  fail();
  await advance(delay * 1.26);
}

describe('Artwork', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('renders the chosen image while it works', () => {
    render(<Artwork src="https://example.com/cover.jpg" alt="Blue Monday" />);
    const img = screen.getByRole('img', { name: 'Blue Monday' });
    expect(img.getAttribute('src')).toBe('https://example.com/cover.jpg');
  });

  it('shows the normal placeholder when no artwork was chosen', () => {
    render(<Artwork src="" alt="Blue Monday" />);
    expect(screen.queryByRole('img', { name: /Blue Monday/ })).toBeTruthy();
    expect(screen.queryByText('No artwork')).toBeNull();
  });

  it('says nothing is wrong while it is still retrying', async () => {
    vi.useFakeTimers();
    render(<Artwork src="https://example.com/flaky.jpg" alt="Flaky" />);
    fail();

    // Still inside the retry window: no broken tile shown.
    expect(screen.queryByText('No artwork')).toBeNull();
    await advance(RETRY_DELAYS_MS[0] * 1.26);

    // The retry asks for the image again, past any cached refusal.
    const img = screen.getByRole('img', { name: 'Flaky' });
    expect(img.getAttribute('src')).toContain('needle-retry=1');
    expect(screen.queryByText('No artwork')).toBeNull();
  });

  it('gives the image back on its own once the host serves it again', async () => {
    vi.useFakeTimers();
    render(<Artwork src="https://yt3.googleusercontent.com/abc=w544" alt="Avatar" />);
    fail();
    await advance(RETRY_DELAYS_MS[0] * 1.26);

    // The retried request succeeds.
    fireEvent.load(screen.getByRole('img', { name: 'Avatar' }));

    expect(screen.getByRole('img', { name: 'Avatar' }).getAttribute('src'))
      .toContain('yt3.googleusercontent.com');
    expect(screen.queryByText('No artwork')).toBeNull();
  });

  it('falls back to a labelled tile once the retries run out', async () => {
    vi.useFakeTimers();
    render(<Artwork src="https://example.com/gone.jpg" alt="Gone" />);

    for (const delay of RETRY_DELAYS_MS) {
      await failThenRetry(delay);
    }
    fail();

    expect(screen.queryByRole('img', { name: 'Gone' })).toBeNull();
    expect(document.querySelector('.artwork-broken')).toBeTruthy();
    expect(screen.getByText('No artwork')).toBeTruthy();
  });

  it('lets a person start the attempts over', async () => {
    vi.useFakeTimers();
    render(<Artwork src="https://example.com/gone.jpg" alt="Gone" size="hero" />);
    for (const delay of RETRY_DELAYS_MS) {
      await failThenRetry(delay);
    }
    fail();

    fireEvent.click(screen.getByRole('button', { name: /Try loading the artwork for Gone again/ }));

    const img = screen.getByRole('img', { name: 'Gone' });
    expect(img.getAttribute('src')).toBe('https://example.com/gone.jpg');
    expect(screen.queryByText('No artwork')).toBeNull();
  });

  it('treats YouTube’s grey 120x90 placeholder as missing artwork', async () => {
    vi.useFakeTimers();
    render(<Artwork src="https://i.ytimg.com/vi/gone/hqdefault.jpg" alt="Deleted video" />);

    // The host keeps answering with the same decodable placeholder, so every
    // attempt has to be recognised: one failure per retry, plus the last one.
    for (const delay of RETRY_DELAYS_MS) {
      const img = screen.getByRole('img', { name: 'Deleted video' });
      Object.defineProperty(img, 'naturalWidth', { value: 120, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 90, configurable: true });
      fireEvent.load(img);
      await advance(delay * 1.26);
    }
    const last = screen.getByRole('img', { name: 'Deleted video' });
    Object.defineProperty(last, 'naturalWidth', { value: 120, configurable: true });
    Object.defineProperty(last, 'naturalHeight', { value: 90, configurable: true });
    fireEvent.load(last);

    expect(document.querySelector('.artwork-broken')).toBeTruthy();
    expect(screen.getByText('No artwork')).toBeTruthy();
  });

  it('keeps a real thumbnail of the same shape', () => {
    render(<Artwork src="https://i.ytimg.com/vi/real/hqdefault.jpg" alt="Real video" />);
    const img = screen.getByRole('img', { name: 'Real video' });
    Object.defineProperty(img, 'naturalWidth', { value: 480 });
    Object.defineProperty(img, 'naturalHeight', { value: 360 });

    fireEvent.load(img);

    expect(screen.queryByText('No artwork')).toBeNull();
    expect(screen.getByRole('img', { name: 'Real video' })).toBe(img);
  });

  it('treats a different URL as a fresh attempt', () => {
    const { rerender } = render(<Artwork src="https://example.com/broken.jpg" alt="A" />);
    fail();
    expect(document.querySelector('.artwork img').getAttribute('src')).toContain('broken.jpg');

    rerender(<Artwork src="https://example.com/working.jpg" alt="A" />);
    expect(screen.getByRole('img', { name: 'A' }).getAttribute('src'))
      .toBe('https://example.com/working.jpg');
  });
});
