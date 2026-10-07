import { useEffect, useMemo, useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { refreshContacts } from './relay-client';
import { useRelayActionsContext, useRelayState } from './useRelay';
import IdentityImport from './IdentityImport';

function handleOf(entry) {
  return entry.handle || entry.from || entry.to || '';
}

/** Opt-in introductions, off by default and never switched on by the app. */
function IntroductionsSwitch() {
  const { client } = useRelayState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!client) return undefined;
    client.introductions()
      .then((result) => { if (alive) setOpen(Boolean(result?.open)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  async function toggle(event) {
    if (!client) return;
    const next = event.target.checked;
    setBusy(true);
    try {
      const result = await client.setIntroductions(next);
      setOpen(Boolean(result?.open ?? next));
    } catch {
      // Leave the switch where it was; the relay will not have changed either.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box className="introductions-switch">
      <FormControlLabel
        control={<Switch checked={open} onChange={toggle} disabled={busy || !client} />}
        label="Let friends of friends find me"
      />
      <Typography variant="body2" color="text.secondary">
        Off unless you say otherwise, and only ever among people who have all turned
        it on. The app never switches this on for you.
      </Typography>
    </Box>
  );
}

/** People a mutual friend could introduce, shown only inside this screen. */
function Suggestions() {
  const { client } = useRelayState();
  const actions = useRelayActionsContext();
  const [suggestions, setSuggestions] = useState([]);
  const [asked, setAsked] = useState({});

  useEffect(() => {
    let alive = true;
    if (!client) return undefined;
    client.introductions()
      .then((result) => { if (alive) setSuggestions(result?.suggestions || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  if (suggestions.length === 0) return null;

  async function ask(suggestion) {
    await actions.requestContact(
      suggestion.handle,
      'hi — it’s me',
      suggestion.via?.[0] ? { via: suggestion.via[0] } : undefined,
    );
    setAsked((current) => ({ ...current, [suggestion.handle]: true }));
  }

  return (
    <Box className="friends-block">
      <Typography component="h3" variant="h5">People you could meet</Typography>
      <Box className="friends-list">
        {suggestions.map((suggestion) => (
          <Box key={suggestion.handle} className="friends-row">
            <Box>
              <Typography className="friends-handle">{`@${suggestion.handle}`}</Typography>
              <Typography variant="body2" color="text.secondary">
                {suggestion.via?.length
                  ? `introduced by ${suggestion.via.map((via) => `@${via}`).join(', ')}`
                  : 'mutual contact'}
                {suggestion.sends?.length
                  ? ` · sends ${suggestion.sends.map((item) => item.name).join(', ')}`
                  : ''}
              </Typography>
            </Box>
            <Button size="small" disabled={asked[suggestion.handle]} onClick={() => ask(suggestion)}>
              {asked[suggestion.handle] ? 'Asked' : 'Ask to connect'}
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** What the relay holds, and for how long. The relay accounts for itself. */
function RetentionNote() {
  const { client } = useRelayState();
  const [retention, setRetention] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!client) return undefined;
    client.retention()
      .then((value) => { if (alive) setRetention(value); })
      .catch(() => {});
    return () => { alive = false; };
  }, [client]);

  if (!retention) return null;
  const days = retention.policy?.bodyTtlDays;
  const held = retention.words?.messages;

  return (
    <Box className="friends-block friends-block-quiet">
      <Typography component="h3" variant="h5">What the relay holds</Typography>
      <Typography variant="body2" color="text.secondary">
        {days
          ? `Message bodies and the sender’s original copy are readable by the relay for up to ${days} days, then deleted.`
          : 'Message bodies are held only for a bounded time, then deleted.'}
        {typeof held === 'number'
          ? ` Right now it holds ${held} ${held === 1 ? 'message' : 'messages'} of yours.`
          : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Translating between differently shaped apps needs the plaintext — that is the
        product. Published examples and your contact list are kept until you delete them.
      </Typography>
    </Box>
  );
}

export default function ConnectionsSection() {
  const { roster, connection, client, me } = useRelayState();
  const actions = useRelayActionsContext();
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('hi — it’s me');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const contacts = useMemo(() => roster.contacts.map(handleOf).filter(Boolean), [roster.contacts]);
  const incoming = useMemo(() => roster.incoming.map(handleOf).filter(Boolean), [roster.incoming]);
  const outgoing = useMemo(() => roster.outgoing.map(handleOf).filter(Boolean), [roster.outgoing]);

  useEffect(() => {
    // Called whenever the screen is shown. Never a local copy: the roster is
    // the relay's to keep.
    refreshContacts();
  }, []);

  async function request(event) {
    event.preventDefault();
    const to = handle.trim().replace(/^@/, '').toLowerCase();
    if (!to) {
      setError('Enter the @handle of the person you want to connect with.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await actions.requestContact(to, note.trim() || 'hi — it’s me');
    setBusy(false);
    if (!result) {
      setError('The relay could not be reached. Try again in a moment.');
      return;
    }
    setHandle('');
    setMessage(
      result.status === 'already-accepted'
        ? `You’re already connected with @${to}.`
        : `Asked @${to} to connect. They accept first — nothing can reach them until they do.`,
    );
  }

  async function accept(from) {
    await actions.acceptContact(from);
    await refreshContacts();
    setMessage(`You’re connected with @${from}.`);
  }

  async function decline(from) {
    await actions.declineContact(from);
    await refreshContacts();
  }

  return (
    <Box className="friends-grid">
      <Box className="friends-column">
        <Box className="friends-block">
          <Typography component="h3" variant="h5">Ask someone to connect</Typography>
          <Typography variant="body2" color="text.secondary">
            A handle is all you need. They accept first — nothing is sent until they do.
          </Typography>
          <Box component="form" className="friends-form" onSubmit={request}>
            {error && <Alert severity="error">{error}</Alert>}
            {message && <Alert severity="success">{message}</Alert>}
            <TextField
              label="Their handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@sam"
              size="small"
              fullWidth
            />
            <TextField
              label="Message with the request"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              size="small"
              fullWidth
            />
            <Button type="submit" variant="contained" startIcon={<AddRoundedIcon />} disabled={busy}>
              Ask to connect
            </Button>
          </Box>
        </Box>

        {incoming.length > 0 && (
          <Box className="friends-block">
            <Typography component="h3" variant="h5">Waiting for you</Typography>
            <Box className="friends-list">
              {roster.incoming.map((entry) => {
                const from = handleOf(entry);
                return (
                  <Box key={from} className="friends-row">
                    <Box>
                      <Typography className="friends-handle">{`@${from}`}</Typography>
                      {entry.via && (
                        <Typography variant="body2" color="text.secondary">
                          {`introduced by @${entry.via}`}
                        </Typography>
                      )}
                    </Box>
                    <Box className="friends-row-actions">
                      <Button size="small" variant="contained" onClick={() => accept(from)}>Accept</Button>
                      <Button size="small" color="inherit" onClick={() => decline(from)}>Decline</Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {outgoing.length > 0 && (
          <Box className="friends-block">
            <Typography component="h3" variant="h5">Asked, not answered</Typography>
            <Box className="friends-chip-row">
              {outgoing.map((to) => <Chip key={to} label={`@${to}`} variant="outlined" />)}
            </Box>
          </Box>
        )}
      </Box>

      <Box className="friends-column">
        <Box className="friends-block">
          <Box className="friends-block-head">
            <Typography component="h3" variant="h5">Sharing with</Typography>
            <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => refreshContacts()}>
              Refresh
            </Button>
          </Box>
          {contacts.length === 0 ? (
            <Typography color="text.secondary">
              Nobody yet. Add a handle on the left; once they accept, they appear here
              and you can send them a listen.
            </Typography>
          ) : (
            <Box className="friends-list">
              {contacts.map((contact) => (
                <Box key={contact} className="friends-row">
                  <Typography className="friends-handle">{`@${contact}`}</Typography>
                  <Typography variant="body2" color="text.secondary">Connected</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Box className="friends-block">
          <Typography component="h3" variant="h5">Introductions</Typography>
          <IntroductionsSwitch />
        </Box>

        <Suggestions />

        <RetentionNote />

        <Box className="friends-block friends-block-quiet">
          <Typography component="h3" variant="h5">This device</Typography>
          <Typography variant="body2" color="text.secondary">
            {connection.state === 'online'
              ? `Connected as @${me.handle} · app ${connection.appId || ''}`
              : 'Not connected to 1-z-2 right now.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The key that identifies this app is generated here and never leaves this device.
          </Typography>
          {!client && <IdentityImport />}
        </Box>
      </Box>
    </Box>
  );
}
