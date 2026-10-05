import { useEffect, useState } from 'react';
import BrokenImageRoundedIcon from '@mui/icons-material/BrokenImageRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, Button, Typography } from '@mui/material';
import { isYouTubePlaceholderThumbnail } from '../utils/media';
import { RETRY_DELAYS_MS, jitter, withRetryToken } from '../utils/artworkRetry';

/**
 * Artwork falls back rather than failing silently. A remote image can stop
 * working long after it was saved, and the stored URL stays in the entry:
 *
 *  - the host answers with an error page (a rate limit, for instance), which
 *    Chromium refuses to treat as an image at all (ORB) and reports as error;
 *  - the host answers 404 with nothing, so the browser fires error;
 *  - YouTube answers 404 with a valid grey placeholder JPEG, so the browser
 *    fires load and the app would otherwise paint that grey tile as artwork.
 *
 * Only the first of those is usually temporary, so the component retries on a
 * backoff before showing anything: an image that comes back should simply
 * appear, without the user having to notice and press a button. A URL that is
 * genuinely gone still ends at the fallback tile.
 */
export default function Artwork({ src, alt, className = '', size = 'medium' }) {
  const [state, setState] = useState({ src, attempt: 0, failed: false });

  // A different URL deserves a fresh attempt. Adjusting during render is
  // cheaper than an effect here, which would paint the stale tile once.
  const current = state.src === src ? state : { src, attempt: 0, failed: false };
  if (current !== state) setState(current);

  const { attempt, failed } = current;
  const exhausted = attempt >= RETRY_DELAYS_MS.length;

  // Keep trying while the attempts last. Nothing is shown as broken in the
  // meantime: an image that recovers should look like it was just slow.
  useEffect(() => {
    if (!failed || exhausted) return undefined;
    const timer = setTimeout(() => {
      setState({ src, attempt: attempt + 1, failed: false });
    }, jitter(RETRY_DELAYS_MS[attempt]));
    return () => clearTimeout(timer);
  }, [failed, exhausted, attempt, src]);

  function handleLoad(event) {
    if (isYouTubePlaceholderThumbnail(event.currentTarget)) {
      setState({ src, attempt, failed: true });
    }
  }

  function retryNow() {
    setState({ src, attempt: 0, failed: false });
  }

  if (!src) {
    return (
      <Box className={`artwork artwork-${size} ${className}`}>
        <Box className="artwork-placeholder" role="img" aria-label={`${alt} artwork placeholder`}>
          <span className="record-groove" />
          <MusicNoteRoundedIcon aria-hidden="true" />
        </Box>
      </Box>
    );
  }

  if (failed && exhausted) {
    return (
      <Box className={`artwork artwork-${size} artwork-broken ${className}`}>
        <BrokenImageRoundedIcon aria-hidden="true" />
        <Typography component="span" className="artwork-broken-label">
          No artwork
        </Typography>
        <Button
          size="small"
          color="inherit"
          className="artwork-retry"
          startIcon={<RefreshRoundedIcon fontSize="inherit" />}
          onClick={retryNow}
          title="This artwork link is not returning an image right now. Some hosts refuse one for a few minutes; loading it again often works, and editing the entry lets you replace the link or upload the picture."
          aria-label={`Try loading the artwork for ${alt} again`}
        >
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box className={`artwork artwork-${size} ${className}`}>
      <img
        src={withRetryToken(src, attempt)}
        alt={alt}
        loading="lazy"
        onLoad={handleLoad}
        onError={() => setState({ src, attempt, failed: true })}
      />
    </Box>
  );
}
