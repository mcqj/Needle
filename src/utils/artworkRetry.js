/**
 * How long the artwork component waits before each automatic retry, in
 * milliseconds. A host that throttles — Google's image CDNs answer 429 with an
 * HTML error page, which Chromium then refuses as ORB — starts serving again
 * after a while. The waits grow quickly so a transient refusal resolves on its
 * own, while a link that is genuinely dead still reaches the fallback promptly.
 *
 * Total worst case, with jitter, is a little over a minute.
 */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/** Spread retries so a screen of failed images does not hit one host at once. */
export function jitter(ms) {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/** Add a one-off parameter so a refusal the browser cached is not re-used. */
export function withRetryToken(src, attempt) {
  if (!attempt) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}needle-retry=${attempt}`;
}
