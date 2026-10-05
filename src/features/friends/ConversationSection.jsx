import { useEffect, useMemo, useRef, useState } from 'react';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAtom } from 'jotai';
import { activePeerAtom, chatThreadsAtom } from '../../state/friendsAtoms';
import { useRelayActionsContext, useRelayState } from './useRelay';

function stamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function ConversationSection() {
  const { roster, chatEnabled, connection } = useRelayState();
  const actions = useRelayActionsContext();
  const [threads] = useAtom(chatThreadsAtom);
  const [peer, setPeer] = useAtom(activePeerAtom);
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  const contacts = useMemo(
    () => roster.contacts.map((contact) => contact.handle).filter(Boolean),
    [roster.contacts],
  );

  const active = peer || contacts[0] || '';
  const thread = threads[active] || [];

  useEffect(() => {
    // Not every environment implements scrollIntoView; the thread still works.
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [thread.length, active]);

  if (chatEnabled && chatEnabled.enabled === false) {
    return (
      <Box className="friends-empty">
        <Typography component="h2" variant="h3">Conversation lives in another app.</Typography>
        <Typography>
          {chatEnabled.reason
            || 'You already carry your 1-z-2 conversations in another app you own, so Needle keeps out of the way.'}
        </Typography>
      </Box>
    );
  }

  if (contacts.length === 0) {
    return (
      <Box className="friends-empty">
        <Typography component="h2" variant="h3">No one to talk to yet.</Typography>
        <Typography>
          Plain notes between contacts, identical in every app, so they never need
          translating. Add someone on the Sharing with screen first.
        </Typography>
      </Box>
    );
  }

  async function sendNote(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    setDraft('');
    await actions.sendChat(active, text);
  }

  return (
    <Box className="conversation">
      <Box className="conversation-peers" aria-label="Contacts">
        {contacts.map((contact) => (
          <Chip
            key={contact}
            label={`@${contact}`}
            onClick={() => setPeer(contact)}
            color={contact === active ? 'primary' : 'default'}
            variant={contact === active ? 'filled' : 'outlined'}
          />
        ))}
      </Box>

      <Box className="conversation-thread">
        {thread.length === 0 ? (
          <Typography color="text.secondary" className="conversation-blank">
            No notes with {`@${active}`} yet. Say something plain — it arrives as written.
          </Typography>
        ) : (
            thread.map((note) => (
            <Box key={note.id} className={`note note-${note.direction}`}>
              <Typography className="note-text">{note.text}</Typography>
              <Typography variant="body2" className="note-time">
                {note.pending ? `written ${stamp(note.sentAt)} · not sent yet` : stamp(note.sentAt)}
              </Typography>
            </Box>
          ))
        )}
        <span ref={endRef} />
      </Box>

      {connection.state !== 'online' && (
        <Alert severity="info">Notes queue in the app while 1-z-2 is unreachable.</Alert>
      )}

      <Box component="form" className="conversation-compose" onSubmit={sendNote}>
        <TextField
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Write to @${active}`}
          aria-label={`Write to @${active}`}
          size="small"
          fullWidth
        />
        <Button type="submit" variant="contained" startIcon={<SendRoundedIcon />} disabled={!draft.trim()}>
          Send
        </Button>
      </Box>
    </Box>
  );
}
