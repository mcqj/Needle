const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).toString();
  } catch {
    return new URL(`https://${trimmed}`).toString();
  }
}

export function getYouTubeId(value) {
  if (!value) return null;

  try {
    const url = new URL(normalizeUrl(value));
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (YOUTUBE_HOSTS.has(url.hostname)) {
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
      if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || null;
      return url.searchParams.get('v');
    }
  } catch {
    return null;
  }

  return null;
}

export function getAutomaticArtwork(value) {
  const youtubeId = getYouTubeId(value);
  return youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : '';
}

/**
 * YouTube answers a missing thumbnail with HTTP 404 but a *valid* 120x90 grey
 * placeholder JPEG, so the browser fires load, not error, and the app would
 * paint that grey tile as though it were artwork. Detect the placeholder so it
 * can be treated as "no artwork".
 */
export function isYouTubePlaceholderThumbnail({ naturalWidth, naturalHeight, byteSize } = {}) {
  const isPlaceholderShape = naturalWidth === 120 && naturalHeight === 90;
  // The placeholder is a tiny file; a real 120x90 image is not. Only applied
  // when the size is actually known.
  const isPlaceholderSize = typeof byteSize !== 'number' || byteSize < 3000;
  return isPlaceholderShape && isPlaceholderSize;
}

export function getSourceLabel(value) {
  if (!value) return 'Link';

  try {
    const hostname = new URL(normalizeUrl(value)).hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) return 'YouTube';
    if (hostname.endsWith('spotify.com')) return 'Spotify';
    if (hostname.endsWith('bandcamp.com')) return 'Bandcamp';
    if (hostname.endsWith('soundcloud.com')) return 'SoundCloud';
    return hostname;
  } catch {
    return 'Link';
  }
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
