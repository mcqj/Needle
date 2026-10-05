import { useState } from 'react';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import Artwork from '../../components/Artwork';
import RatingMarks from '../../components/RatingMarks';
import { receivedFromPeopleAtom, receivedFromTestsAtom, sentTracksAtom } from '../../state/friendsAtoms';
import { useRelayActionsContext } from './useRelay';
import { SEND_COPY } from './relayStore';
import { RELAY_URL } from './relay-client';
import { formatDate } from '../../utils/media';

function RelativeTime({ value }) {
  if (!value) return null;
  return <>{formatDate(value)}</>;
}

/** "See what they sent" — raw JSON, no styling. It is evidence, not UI. */
function OriginalView({ messageId }) {
  const { loadOriginal } = useRelayActionsContext();
  const [original, setOriginal] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  async function show() {
    setOpen(true);
    if (original || error) return;
    const result = await loadOriginal(messageId);
    if (result) setOriginal(result);
    else setError('The sender’s original copy is no longer available.');
  }

  return (
    <>
      <Button size="small" color="inherit" onClick={show}>
        See what they sent
      </Button>
      {open && error && <Typography variant="body2" color="text.secondary">{error}</Typography>}
      {open && original && (
        <Box component="pre" className="original-json">
          {JSON.stringify(original.original, null, 2)}
        </Box>
      )}
    </>
  );
}

function Provenance({ provenance }) {
  if (!provenance || provenance.kind === 'plain') return null;

  if (provenance.kind === 'translated') {
    return (
      <Box className="provenance">
        <Typography variant="body2" color="text.secondary">{provenance.badge}</Typography>
        {provenance.dropped?.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {`Their version also had: ${provenance.dropped.join(', ')}`}
          </Typography>
        )}
        {provenance.assumed?.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {`Read into it here: ${provenance.assumed.join(', ')}`}
          </Typography>
        )}
        <OriginalView messageId={provenance.messageId} />
      </Box>
    );
  }

  return (
    <Box className="provenance provenance-untranslated">
      <Typography variant="body2" color="text.secondary">{provenance.note}</Typography>
      {provenance.failure && (
        <Typography variant="body2" color="text.secondary">{provenance.failure}</Typography>
      )}
      {provenance.page && (
        <a href={new URL(provenance.page, RELAY_URL).toString()} target="_blank" rel="noreferrer">
          Open it on the relay’s reader
        </a>
      )}
    </Box>
  );
}

function ReceivedTrack({ item }) {
  const { addToLibrary } = useRelayActionsContext();
  const [imported, setImported] = useState(Boolean(item.importedTrackId));
  const track = item.track || {};

  return (
    <Box component="article" className="received-card">
      <Artwork src={track.imageUrl} alt={`${track.title || 'Received listen'} artwork`} size="medium" />
      <Box className="received-copy">
        <Box className="received-meta">
          <Chip size="small" color="primary" variant="outlined" label={`from @${item.from}`} />
          <Typography variant="body2" color="text.secondary">
            <RelativeTime value={item.receivedAt} />
          </Typography>
        </Box>
        <Typography component="h3" className="received-title">{track.title || 'Untitled listen'}</Typography>
        {track.artist && <Typography className="received-artist">{track.artist}</Typography>}
        {(track.rating || 0) > 0 && <RatingMarks value={track.rating} compact />}
        {track.category && (
          <Box className="received-tags"><Chip size="small" label={track.category} variant="outlined" /></Box>
        )}
        {track.review && (
          <Typography component="blockquote" className="received-review">{track.review}</Typography>
        )}
        <Box className="received-actions">
          {imported ? (
            <Typography variant="body2" className="received-imported">
              <CheckRoundedIcon fontSize="small" /> In your ledger, marked as from {`@${item.from}`}
            </Typography>
          ) : (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlaylistAddRoundedIcon />}
              onClick={() => {
                addToLibrary(item);
                setImported(true);
              }}
            >
              Add to my ledger
            </Button>
          )}
          {track.url && (
            <Button
              size="small"
              color="inherit"
              component="a"
              href={track.url}
              target="_blank"
              rel="noreferrer"
              endIcon={<LaunchRoundedIcon fontSize="small" />}
            >
              Listen
            </Button>
          )}
        </Box>
        <Provenance provenance={item.provenance} />
      </Box>
    </Box>
  );
}

/**
 * A payload the relay could not translate, or of a kind this app does not
 * know. Shown honestly as raw JSON rather than dressed up as local data.
 */
function ReceivedUnknown({ item }) {
  return (
    <Box component="article" className="received-card received-card-unknown received-card-single">
      <Box className="received-copy">
        <Box className="received-meta">
          <Chip size="small" color="secondary" variant="outlined" label={`from @${item.from}`} />
          <Typography variant="body2" color="text.secondary">
            <RelativeTime value={item.receivedAt} />
          </Typography>
          {item.unknownType && (
            <Typography variant="body2" color="text.secondary">{`sent as “${item.unknownType}”`}</Typography>
          )}
        </Box>
        <Typography component="h3" className="received-title">
          Something Needle can’t read yet
        </Typography>
        <Provenance provenance={item.provenance} />
        <Box component="pre" className="original-json">
          {JSON.stringify(item.payload, null, 2)}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * What this app sent, and what became of it. The relay compiles a translation
 * on the first exchange between two shapes, so the item does not go out exactly
 * as typed: it arrives as whatever the recipient's app calls it. Saying so is
 * the difference between "did they get it?" and guessing.
 */
function SentReceipts({ items }) {
  if (items.length === 0) return null;

  return (
    <Box className="sent-block">
      <Typography component="h2" variant="h5">Sent</Typography>
      <Typography variant="body2" color="text.secondary">
        The relay adapts each listen to the shape the recipient’s app uses.
      </Typography>
      <Box className="sent-list">
        {items.map((entry) => {
          const state = SEND_COPY[entry.status] || entry.status;
          const done = entry.status === 'sent';
          return (
            <Box key={entry.idempotencyKey} className="sent-row">
              <Box className="sent-copy">
                <Typography className="sent-title">
                  {entry.track?.title || 'A listen'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`to @${entry.handle}`}
                  {entry.arrivedAs ? ` · arrives as “${entry.arrivedAs}”` : ''}
                </Typography>
                {entry.error && (
                  <Typography variant="body2" color="text.secondary">{entry.error}</Typography>
                )}
              </Box>
              <Box className="sent-status">
                <Chip
                  size="small"
                  variant="outlined"
                  color={done ? 'success' : entry.status === 'failed' ? 'error' : 'default'}
                  label={state}
                />
                {entry.page && (
                  <a href={entry.page} target="_blank" rel="noreferrer">Open the page they can read</a>
                )}
                {(entry.status === 'failed' || entry.status === 'unknown') && (
                  <RetrySendButton sendKey={entry.idempotencyKey} />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Try the same message again. Works from the saved receipt alone, so it still
 * works after a reload, and it reuses the original idempotency key.
 */
function RetrySendButton({ sendKey }) {
  const { retrySend } = useRelayActionsContext();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await retrySend(sendKey);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="small" onClick={retry} disabled={busy}>
      {busy ? 'Trying…' : 'Try again'}
    </Button>
  );
}

/**
 * Traffic from the relay's own echo account, which the integration self-test
 * uses. It is kept apart and folded away: it is not a person, and its payloads
 * are not in any app's shape, so mixing it into the inbox reads as breakage.
 */
function TestTraffic({ items }) {
  const [open, setOpen] = useState(false);

  return (
    <Box className="test-traffic">
      <Button size="small" color="inherit" onClick={() => setOpen((value) => !value)}>
        {open
          ? 'Hide integration test messages'
          : `Show ${items.length} integration test ${items.length === 1 ? 'message' : 'messages'} from @relay-echo`}
      </Button>
      {open && (
        <Box className="received-list">
          {items.map((item) => (
            item.track
              ? <ReceivedTrack key={item.id} item={item} />
              : <ReceivedUnknown key={item.id} item={item} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function ReceivedSection() {
  const received = useAtomValue(receivedFromPeopleAtom);
  const testTraffic = useAtomValue(receivedFromTestsAtom);
  const sent = useAtomValue(sentTracksAtom);

  if (received.length === 0 && sent.length === 0 && testTraffic.length === 0) {
    return (
      <Box className="friends-empty">
        <Typography component="h2" variant="h3">Nothing shared with you yet.</Typography>
        <Typography>
          When a friend sends a listen from their own app — whatever shape it stores —
          it lands here, adapted to yours. It stays out of your ledger until you add it.
        </Typography>
        <Alert severity="info" className="friends-note">
          These are other people’s records. They are never counted in your saved listens,
          categories, or stats.
        </Alert>
      </Box>
    );
  }

  return (
    <>
      <Box className="received-head">
        <Typography component="h2" variant="h5">Shared with me</Typography>
        <Typography variant="body2" color="text.secondary">
          Kept separate from your own ledger. Add one only if you want it there.
        </Typography>
      </Box>

      {received.length === 0 ? (
        <Typography color="text.secondary" className="received-none">
          Nothing from a person yet. A listen someone sends appears here, in your shape.
        </Typography>
      ) : (
        <Box className="received-list">
          {received.map((item) => (
            item.track
              ? <ReceivedTrack key={item.id} item={item} />
              : <ReceivedUnknown key={item.id} item={item} />
          ))}
        </Box>
      )}

      <SentReceipts items={sent} />
      {testTraffic.length > 0 && <TestTraffic items={testTraffic} />}
    </>
  );
}
