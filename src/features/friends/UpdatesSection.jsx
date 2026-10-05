import { useCallback, useEffect, useState } from 'react';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { useRelayState } from './useRelay';

const REFRESH_MS = 3 * 60 * 1000;

function ago(value) {
  if (!value) return 'earlier';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * What the entry actually means. The feed is a list of capabilities, so the
 * wording here is what stops "added song-pick" from reading as "they sent me a
 * song-pick" — they published the ability to send one, which is a different
 * event entirely.
 */
function UpdateDetail({ update, onClose }) {
  const { client } = useRelayState();
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    if (!client) return;
    const prompt = client.featurePrompt(update);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Box className="update-detail">
      <Box className="update-detail-head">
        <Box>
          <Typography component="h3" variant="h5">{`${update.name} from @${update.from}`}</Typography>
          <Typography variant="body2" color="text.secondary">
            {update.app ? `${update.app} · ` : ''}
            {update.kind === 'changed' ? 'their app changed this' : 'their app added this'}
            {update.at ? ` · ${ago(update.at)}` : ''}
          </Typography>
        </Box>
        <Button size="small" color="inherit" onClick={onClose}>Close</Button>
      </Box>

      <Typography>{update.description}</Typography>

      <Box className="update-meaning">
        <Typography variant="body2" color="text.secondary">
          {update.yours === 'ready'
            ? `This is something @${update.from} can send you. Needle already takes it: it would arrive as “${update.landsAs}”, in your ledger's own shape.`
            : `This is something @${update.from} can send you, but nothing in Needle takes it yet.`}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          They have not sent you one. Nothing arrives here until they do — and
          when they do, it appears under “Shared with me”.
        </Typography>
      </Box>

      {update.yours !== 'ready' && (
        <Box className="update-prompt">
          <Typography>Would you like to add this?</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyRoundedIcon />}
            onClick={copyPrompt}
          >
            {copied ? 'Copied' : 'Copy the request'}
          </Button>
          <Typography variant="body2" color="text.secondary">
            Paste it to the AI that built Needle. Needle will not add it on its own.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default function UpdatesSection() {
  const { client, connection } = useRelayState();
  const [updates, setUpdates] = useState(null);
  const [openName, setOpenName] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.updates();
      setUpdates(result?.updates || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return undefined;
    // Loaded asynchronously, then on a slow timer while the screen is open.
    // There is nothing to store: the feed is the relay's to keep.
    const tick = async () => { await load(); };
    Promise.resolve().then(tick);
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, [client, load]);

  if (!client) {
    return (
      <Box className="friends-empty">
        <Typography component="h2" variant="h3">No updates to show.</Typography>
        <Typography>
          {connection.state === 'connecting'
            ? 'Still connecting to 1-z-2.'
            : 'The updates feed needs the relay. Your ledger works without it.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box className="updates">
      <Box className="friends-block-head">
        <Box>
          <Typography component="h2" variant="h5">What your friends’ apps can send</Typography>
          <Typography variant="body2" color="text.secondary">
            Each line is a feature a contact’s app has published. Nothing here has
            been sent to you — open one to see what it means.
          </Typography>
        </Box>
        <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={load}>Refresh</Button>
      </Box>

      {failed && <Alert severity="error">The relay could not be reached.</Alert>}

      {(updates || []).length === 0 ? (
        <Typography color="text.secondary">
          {updates
            ? 'Nothing yet. Once a contact’s app publishes something new, it shows up here.'
            : 'Checking what your friends’ apps can send…'}
        </Typography>
      ) : (
        <Box className="update-list">
          {updates.map((update) => {
            const key = `${update.from}:${update.name}`;
            const open = openName === key;
            return (
              <Box key={key} className="update-row">
                <Box
                  className="update-line"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => setOpenName(open ? '' : key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setOpenName(open ? '' : key);
                  }}
                >
                  <Typography>
                    {`@${update.from} added ${update.name}`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {update.yours === 'ready' ? 'you can receive this' : 'not received yet'}
                    {update.at ? ` · ${ago(update.at)}` : ''}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={update.kind === 'changed' ? 'secondary' : 'default'}
                    label={update.kind === 'changed' ? 'changed' : 'new feature'}
                  />
                </Box>
                {open && <UpdateDetail update={update} onClose={() => setOpenName('')} />}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
