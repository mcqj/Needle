import { useEffect } from 'react';import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useSearchParams } from 'react-router';
import { unseenReceivedCountAtom } from '../../state/friendsAtoms';
import { useRelayState } from './useRelay';
import { useRelayActions } from './relayStore';
import ConnectionsSection from './ConnectionsSection';
import ReceivedSection from './ReceivedSection';
import ConversationSection from './ConversationSection';
import UpdatesSection from './UpdatesSection';

const TABS = [
  { value: 'sharing', label: 'Sharing with' },
  { value: 'received', label: 'Shared with me' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'updates', label: 'Updates' },
];

export default function FriendsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  // The URL is the source of truth, so a link into a section always lands there.
  const tab = TABS.some((item) => item.value === requested) ? requested : 'sharing';
  const unseen = useAtomValue(unseenReceivedCountAtom);
  const { markReceivedSeen } = useRelayActions();
  const { connection, me } = useRelayState();

  // Arriving on the received tab by any route — tab click, link, or a message
  // landing while it is already open — clears the badge.
  useEffect(() => {
    if (tab !== 'received') return;
    // Deferred so the marking never runs during the same render pass.
    Promise.resolve().then(() => markReceivedSeen());
  }, [tab, unseen, markReceivedSeen]);

  function changeTab(event, value) {
    setSearchParams(value === 'sharing' ? {} : { tab: value }, { replace: true });
  }

  const statusLabel = connection.state === 'online'
    ? `Connected as @${me.handle}`
    : connection.state === 'connecting'
      ? 'Connecting to 1-z-2…'
      : connection.state === 'offline'
        ? '1-z-2 is unreachable — your ledger still works'
        : connection.state === 'error'
          ? connection.error
          : 'Not connected yet';

  return (
    <Container maxWidth={false} className="friends-page">
      <Box component="section" className="friends-intro">
        <Box>
          <Typography component="h1" variant="h1">Listening circle</Typography>
          <Typography className="intro-copy">
            Exchange listens with people whose apps were built somewhere else entirely.
            1-z-2 translates between their shape and yours.
          </Typography>
        </Box>
        <Box className="friends-status" data-state={connection.state} aria-live="polite">
          <span className="friends-status-dot" aria-hidden="true" />
          <Typography variant="body2">{statusLabel}</Typography>
        </Box>
      </Box>

      <Tabs
        value={tab}
        onChange={changeTab}
        variant="scrollable"
        scrollButtons="auto"
        className="friends-tabs"
        aria-label="Listening circle sections"
      >
        {TABS.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            label={item.value === 'received' && unseen > 0 ? (
              <Badge color="secondary" badgeContent={unseen}>{item.label}</Badge>
            ) : item.label}
          />
        ))}
      </Tabs>

      <Box className="friends-body">
        {tab === 'sharing' && <ConnectionsSection />}
        {tab === 'received' && <ReceivedSection />}
        {tab === 'conversation' && <ConversationSection />}
        {tab === 'updates' && <UpdatesSection />}
      </Box>
    </Container>
  );
}
