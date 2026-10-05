import { describe, expect, it } from 'vitest';
import {
  getAutomaticArtwork,
  getSourceLabel,
  getYouTubeId,
  isYouTubePlaceholderThumbnail,
  normalizeUrl,
} from './media';

describe('media utilities', () => {
  it('normalizes links without a protocol', () => {
    expect(normalizeUrl('bandcamp.com/track/example')).toBe('https://bandcamp.com/track/example');
  });

  it.each([
    ['https://www.youtube.com/watch?v=abc123', 'abc123'],
    ['https://youtu.be/abc123?t=4', 'abc123'],
    ['https://youtube.com/shorts/abc123', 'abc123'],
  ])('extracts a YouTube id from %s', (url, expected) => {
    expect(getYouTubeId(url)).toBe(expected);
  });

  it('builds automatic artwork for YouTube links', () => {
    expect(getAutomaticArtwork('https://youtu.be/abc123')).toBe(
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    );
  });

  it('recognizes common listening sources', () => {
    expect(getSourceLabel('https://open.spotify.com/track/123')).toBe('Spotify');
    expect(getSourceLabel('https://artist.bandcamp.com/track/example')).toBe('Bandcamp');
  });
});

describe('isYouTubePlaceholderThumbnail', () => {
  it('recognises the grey placeholder YouTube serves for a missing video', () => {
    expect(isYouTubePlaceholderThumbnail({ naturalWidth: 120, naturalHeight: 90 })).toBe(true);
  });

  it('rejects a real thumbnail', () => {
    expect(isYouTubePlaceholderThumbnail({ naturalWidth: 480, naturalHeight: 360 })).toBe(false);
    expect(isYouTubePlaceholderThumbnail({ naturalWidth: 1280, naturalHeight: 720 })).toBe(false);
  });

  it('rejects a 120x90 image large enough to be real content', () => {
    expect(isYouTubePlaceholderThumbnail({ naturalWidth: 120, naturalHeight: 90, byteSize: 24000 })).toBe(false);
  });

  it('is safe with missing dimensions', () => {
    expect(isYouTubePlaceholderThumbnail()).toBe(false);
    expect(isYouTubePlaceholderThumbnail({})).toBe(false);
  });
});
