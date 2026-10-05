import { useMemo, useState } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useRelayActionsContext, useRelayState } from './useRelay';
import { useSendState } from './relayStore';

/**
 * The send action. Asks for a handle, then hands the item to the relay and
 * closes immediately: delivery progress shows on the item itself, never as a
 * blocking dialog.
 */
export function SendTrackDialog({ open, track, onClose, onSent }) {
  const { sendTrack } = useRelayActionsContext();
  const { roster } = useRelayState();
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const contacts = useMemo(
    () => roster.contacts.map((contact) => contact.handle).filter(Boolean),
    [roster.contacts],
  );

  const canSend = Boolean(track) && Boolean(handle.trim());

  async function handleSend() {
    const to = handle.trim().replace(/^@/, '');
    if (!to) {
      setError('Add the @handle of the person to send to.');
      return;
    }
    // The note is folded into the review the app already stores, so the relay
    // and the recipient's app only ever see Needle's own shape.
    const outgoing = note.trim()
      ? { ...track, review: [track?.review, note.trim()].filter(Boolean).join('\n\n') }
      : track;
    const result = await sendTrack(to, outgoing);
    if (!result) {
      setError('The relay could not be reached. Your ledger is unaffected.');
      return;
    }
    onSent?.(to, result);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle component="div" className="dialog-title">
        <Box>
          <Typography component="h2" variant="h5">Send this listen</Typography>
          <Typography variant="body2" color="text.secondary">
            {track ? `“${track.title}” by ${track.artist}` : ''}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close dialog">
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box className="send-dialog-body">
          {error && <Alert severity="error">{error}</Alert>}
          {contacts.length > 0 ? (
            <FormControl fullWidth size="small">
              <InputLabel id="send-contact-label">Send to</InputLabel>
              <Select
                labelId="send-contact-label"
                label="Send to"
                value={contacts.includes(handle) ? handle : ''}
                onChange={(event) => setHandle(event.target.value)}
              >
                {contacts.map((contact) => (
                  <MenuItem key={contact} value={contact}>{`@${contact}`}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Alert severity="info">
              Nobody to send to yet. Add someone on the Sharing with screen first —
              they have to accept before a listen can reach them.
            </Alert>
          )}
          <TextField
            label="Or type a handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="@sam"
            fullWidth
            size="small"
          />
          <TextField
            label="Note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="You'd like this one."
            fullWidth
            size="small"
          />
          <Typography variant="body2" color="text.secondary">
            Nothing leaves Needle until you press send, and only this one listen goes.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions className="dialog-actions">
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<SendRoundedIcon />}
          onClick={handleSend}
          disabled={!canSend}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * One line of progress, on the item that was sent. A bare "sending…" that
 * lasts a minute reads as broken, so the first exchange explains itself.
 */
export function SendStatusLine({ sendKey, compact = false }) {
  const state = useSendState(sendKey);
  const { checkSend, retrySend } = useRelayActionsContext();
  if (!state) return null;

  const handle = state.handle ? `@${state.handle}` : 'your contact';

  if (state.status === 'sending') {
    return (
      <Typography className="send-status" variant="body2" color="text.secondary">
        {`Sending to ${handle}…`}
      </Typography>
    );
  }

  if (state.status === 'compiling') {
    return (
      <Typography className="send-status" variant="body2" color="text.secondary">
        {`First time sending to ${handle} — setting up, about a minute. After this it’s instant.`}
      </Typography>
    );
  }

  if (state.status === 'sent') {
    return (
      <Box component="span" className="send-status send-status-done">
        <Typography variant="body2" component="span">{`Sent to ${handle}`}</Typography>
        {state.page && (
          <a href={state.page} target="_blank" rel="noreferrer">Open the page they can read</a>
        )}
      </Box>
    );
  }

  if (state.status === 'failed') {
    return (
      <Box component="span" className="send-status send-status-failed">
        <Typography variant="body2" component="span">{`Not delivered to ${handle}`}</Typography>
        {state.error && (
          <Typography variant="body2" color="text.secondary" component="span">{state.error}</Typography>
        )}
        {!compact && (
          <Button size="small" onClick={() => retrySend(sendKey)}>Try again</Button>
        )}
      </Box>
    );
  }

  if (state.status === 'unknown') {
    return (
      <Box component="span" className="send-status">
        <Typography variant="body2" color="text.secondary" component="span">
          {`Still setting up for ${handle}.`}
        </Typography>
        <Button size="small" onClick={() => checkSend(sendKey)}>Check again</Button>
      </Box>
    );
  }

  if (state.status === 'expired') {
    return (
      <Typography className="send-status" variant="body2" color="text.secondary">
        This send expired before it was delivered.
      </Typography>
    );
  }

  return null;
}

/**
 * "Send to contact" plus the progress line for that item. Dropped onto every
 * surface that displays a listen.
 */
export function TrackSendButton({ track, size = 'small', label = 'Send' }) {
  const [open, setOpen] = useState(false);
  const [sendKey, setSendKey] = useState(null);

  return (
    <>
      <Button
        size={size}
        startIcon={<SendRoundedIcon fontSize="small" />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {sendKey && <SendStatusLine sendKey={sendKey} />}
      {open && (
        <SendTrackDialog
          open
          track={track}
          onClose={() => setOpen(false)}
          onSent={(_to, result) => setSendKey(result.idempotencyKey)}
        />
      )}
    </>
  );
}
