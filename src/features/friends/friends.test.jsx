import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { receivedTracksAtom, sentTracksAtom } from '../../state/friendsAtoms';

// Mutated per test: the relay is never contacted, the plumbing is a stub.
const client = {
  updates: vi.fn(async () => ({ updates: [] })),
  featurePrompt: vi.fn(() => 'paste me'),
  introductions: vi.fn(async () => ({ open: false, suggestions: [] })),
  retention: vi.fn(async () => ({ policy: { bodyTtlDays: 10 }, words: { messages: 0 } })),
  setIntroductions: vi.fn(async (open) => ({ open })),
};

const relayState = {
  me: { handle: 'jmq' },
  connection: { state: 'online', error: '', appId: 'app-1' },
  roster: { contacts: [{ handle: 'sam' }], incoming: [], outgoing: [], blocked: [] },
  chatEnabled: { enabled: true },
  client,
};

const actions = {
  loadOriginal: vi.fn(async () => ({ original: { weird: 'shape' } })),
  addToLibrary: vi.fn(),
  sendTrack: vi.fn(),
  checkSend: vi.fn(),
  retrySend: vi.fn(),
  requestContact: vi.fn(),
  acceptContact: vi.fn(),
  declineContact: vi.fn(),
  sendChat: vi.fn(),
  markReceivedSeen: vi.fn(),
  retryConnection: vi.fn(),
};

vi.mock('./useRelay', () => ({
  useRelayState: () => relayState,
  useRelayActionsContext: () => actions,
}));

const ReceivedSection = (await import('./ReceivedSection')).default;
const UpdatesSection = (await import('./UpdatesSection')).default;
const ConversationSection = (await import('./ConversationSection')).default;
const ConnectionsSection = (await import('./ConnectionsSection')).default;
// The app must not assume who it is: the credentials carry the handle, so the
// only thing that has to be discoverable is the one thing that keys them.
const { storedHandle, hasStoredIdentity, myHandle, handleFromFilename } = await import('./relay-client');

function renderWith(atomValues, element) {
  const store = createStore();
  for (const [atom, value] of atomValues) store.set(atom, value);
  return render(<Provider store={store}>{element}</Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  client.updates.mockResolvedValue({ updates: [] });
  client.featurePrompt.mockReturnValue('paste me');
  relayState.chatEnabled = { enabled: true };
});

describe('shared with me', () => {
  it('shows an empty state that promises separation from the ledger', () => {
    renderWith([[receivedTracksAtom, []]], <ReceivedSection />);
    expect(screen.getByRole('heading', { name: /Nothing shared with you yet/i })).toBeTruthy();
    expect(screen.getByText(/never counted in your saved listens/i)).toBeTruthy();
  });

  it('attributes a translated item and shows the sender’s original', async () => {
    renderWith([[receivedTracksAtom, [{
      id: 'm1',
      from: 'sam',
      receivedAt: '2025-10-01T10:00:00.000Z',
      provenance: {
        kind: 'translated',
        messageId: 'm1',
        badge: 'translated from "album-pick"',
        dropped: ['mood'],
        assumed: ['category'],
      },
      track: { title: 'Blue Monday', artist: 'New Order', url: 'https://example.com/x', rating: 4 },
    }]]], <ReceivedSection />);

    expect(screen.getByText('from @sam')).toBeTruthy();
    expect(screen.getByText('translated from "album-pick"')).toBeTruthy();
    expect(screen.getByText(/Their version also had: mood/)).toBeTruthy();
    expect(screen.getByText(/Read into it here: category/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /See what they sent/i }));
    await waitFor(() => expect(actions.loadOriginal).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText(/"weird": "shape"/)).toBeTruthy();
  });

  it('never dresses an untranslated payload up as local data', () => {
    renderWith([[receivedTracksAtom, [{
      id: 'm2',
      from: 'sam',
      receivedAt: '2025-10-01T10:00:00.000Z',
      unknownType: 'album-pick',
      payload: { totally: 'different' },
      provenance: {
        kind: 'untranslated',
        messageId: 'm2',
        note: 'This arrived in the shape sam’s app uses.',
        failure: 'no transform compiled yet',
        page: '/m/m2',
      },
    }]]], <ReceivedSection />);

    expect(screen.getByText(/Something Needle can’t read yet/i)).toBeTruthy();
    expect(screen.getByText('This arrived in the shape sam’s app uses.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /relay’s reader/i }).getAttribute('href'),
    ).toBe('https://relay.1-z-2.com/m/m2');
    expect(screen.getByText(/"totally": "different"/)).toBeTruthy();
  });

  it('adds a received listen to the ledger only when asked', async () => {
    renderWith([[receivedTracksAtom, [{
      id: 'm3',
      from: 'sam',
      receivedAt: '2025-10-01T10:00:00.000Z',
      provenance: { kind: 'plain', messageId: 'm3' },
      track: { title: 'Blue Monday', artist: 'New Order', url: 'https://example.com/x' },
    }]]], <ReceivedSection />);

    expect(actions.addToLibrary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Add to my ledger/i }));
    expect(actions.addToLibrary).toHaveBeenCalledTimes(1);
    expect(actions.addToLibrary.mock.calls[0][0].from).toBe('sam');
  });

  it('keeps the relay self-test’s own traffic out of the inbox', () => {
    renderWith([[receivedTracksAtom, [
      {
        id: 'echo',
        from: 'relay-echo',
        receivedAt: '2025-10-01T10:00:00.000Z',
        unknownType: 'selftest-ping',
        payload: { ping: 'selftest-1' },
        provenance: { kind: 'untranslated', messageId: 'echo', note: 'test', failure: 'x', page: null },
      },
      {
        id: 'real',
        from: 'sam',
        receivedAt: '2025-10-01T10:00:00.000Z',
        provenance: { kind: 'plain', messageId: 'real' },
        track: { title: 'A Real Listen', artist: 'A Friend', url: 'https://example.com/r' },
      },
    ]]], <ReceivedSection />);

    // The test artefact is not presented as something a person sent.
    expect(screen.queryByText(/Something Needle can’t read yet/i)).toBeNull();
    expect(screen.getByText('A Real Listen')).toBeTruthy();

    // It is not hidden, though: it is folded away and named for what it is.
    expect(screen.getByRole('button', { name: /Show 1 integration test message from @relay-echo/ })).toBeTruthy();
  });

  it('opens the folded test traffic on request', () => {
    renderWith([[receivedTracksAtom, [{
      id: 'echo',
      from: 'relay-echo',
      receivedAt: '2025-10-01T10:00:00.000Z',
      unknownType: 'selftest-ping',
      payload: { ping: 'selftest-1' },
      provenance: { kind: 'untranslated', messageId: 'echo', note: 'test note', failure: 'x', page: null },
    }]]], <ReceivedSection />);

    fireEvent.click(screen.getByRole('button', { name: /Show 1 integration test message/ }));
    expect(screen.getByText(/"ping": "selftest-1"/)).toBeTruthy();
  });

  it('reports what a sent listen became, so delivery is answerable later', () => {
    renderWith([
      [receivedTracksAtom, []],
      [sentTracksAtom, [
        {
          idempotencyKey: 'k1',
          handle: 'alpha01',
          sentAt: '2025-10-05T18:23:33.318Z',
          status: 'sent',
          arrivedAs: 'song-pick',
          track: { title: 'Circle Test Pressing', artist: 'The Fixtures' },
        },
        {
          idempotencyKey: 'k2',
          handle: 'alpha01',
          sentAt: '2025-10-05T18:00:00.000Z',
          status: 'failed',
          error: 'the relay could not deliver this',
          track: { title: 'Never Arrived', artist: 'Nobody' },
        },
      ]],
    ], <ReceivedSection />);

    expect(screen.getByRole('heading', { name: 'Sent' })).toBeTruthy();
    expect(screen.getByText('Circle Test Pressing')).toBeTruthy();
    // The recipient's own name for the concept, which is what proves the
    // translation compiled.
    expect(screen.getByText(/to @alpha01 · arrives as “song-pick”/)).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();

    // A failure is visible, with a way to try again.
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });
});

describe('updates', () => {
  it('renders before the first fetch answers instead of crashing', async () => {
    renderWith([], <UpdatesSection />);
    expect(screen.getByText(/Checking what your friends’ apps can send/i)).toBeTruthy();
    expect(await screen.findByText(/Nothing yet/i)).toBeTruthy();
    expect(client.updates).toHaveBeenCalled();
  });

  it('reads as a list of what contacts can send, not of what they sent', async () => {
    client.updates.mockResolvedValueOnce({
      updates: [
        { from: 'alpha01', app: 'default', name: 'song-pick', description: 'One song the user chose for the week.', kind: 'added', at: null, yours: 'ready', landsAs: 'saved-listen' },
      ],
    });

    renderWith([], <UpdatesSection />);
    expect(await screen.findByText('@alpha01 added song-pick')).toBeTruthy();

    // Nothing in the list claims an item was received.
    expect(screen.getByText(/Nothing here has\s+been sent to you/)).toBeTruthy();
    expect(screen.getByText(/you can receive this/)).toBeTruthy();

    fireEvent.click(screen.getByText('@alpha01 added song-pick'));
    expect(await screen.findByText(/This is something @alpha01 can send you/)).toBeTruthy();
    expect(screen.getByText(/They have not sent you one/)).toBeTruthy();
    // Already receivable, so there is nothing to add.
    expect(screen.queryByText('Would you like to add this?')).toBeNull();
  });

  it('offers a copy-only request for a feature the app cannot take yet', async () => {
    client.updates.mockResolvedValueOnce({
      updates: [
        { from: 'ali', app: 'Tapebox', name: 'gig-list', description: 'gigs worth going to', kind: 'added', at: Date.now() - 600_000, yours: 'missing', landsAs: null },
      ],
    });

    renderWith([], <UpdatesSection />);
    fireEvent.click(await screen.findByText('@ali added gig-list'));

    expect(await screen.findByText(/nothing in Needle takes it yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Copy the request/i }));
    expect(client.featurePrompt).toHaveBeenCalled();
  });
});

describe('conversation', () => {
  it('steps aside when another of the user’s apps carries the conversations', () => {
    relayState.chatEnabled = { enabled: false, reason: 'another app of yours carries chat' };
    renderWith([], <ConversationSection />);
    expect(screen.getByRole('heading', { name: /Conversation lives in another app/i })).toBeTruthy();
    expect(screen.getByText('another app of yours carries chat')).toBeTruthy();
  });

  it('sends a plain note to the chosen contact', () => {
    renderWith([], <ConversationSection />);
    fireEvent.change(screen.getByPlaceholderText('Write to @sam'), { target: { value: 'that bassline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(actions.sendChat).toHaveBeenCalledWith('sam', 'that bassline');
  });
});

describe('deriving the handle', () => {
  afterEach(() => { localStorage.clear(); });

  it('finds the handle from stored credentials rather than being told it', () => {
    localStorage.setItem('relay:someone-else', JSON.stringify({ token: 't' }));
    expect(storedHandle()).toBe('someone-else');
    expect(hasStoredIdentity()).toBe(true);
  });

  it('handles a different handle than the one this project was built with', () => {
    localStorage.setItem('relay:another-person', JSON.stringify({ token: 't' }));
    expect(storedHandle()).toBe('another-person');
  });

  it('reports no identity when there are no credentials', () => {
    expect(storedHandle()).toBeNull();
    expect(hasStoredIdentity()).toBe(false);
  });

  it('ignores unrelated storage keys', () => {
    localStorage.setItem('needle-library', '[]');
    localStorage.setItem('relay:', 'not-a-handle');
    expect(storedHandle()).toBeNull();
  });

  it('has no handle until a connection exists', () => {
    expect(myHandle()).toBeNull();
  });

  it('reads the handle from the identity filename, which is where it lives', () => {
    // The exported credentials do not carry a `handle` field -- the ones the
    // relay's website writes do not -- so the filename is the reliable source.
    expect(handleFromFilename('.relay-jmq.json')).toBe('jmq');
    expect(handleFromFilename('.relay-someone-else.json')).toBe('someone-else');
    expect(handleFromFilename('relay-jmq.json')).toBeNull();
    expect(handleFromFilename('jmq.json')).toBeNull();
    expect(handleFromFilename('')).toBeNull();
    expect(handleFromFilename(undefined)).toBeNull();
  });

  it('shows the connected handle in the interface, not a literal', () => {
    relayState.me = { handle: 'someone-else' };
    renderWith([], <ConnectionsSection />);
    expect(screen.getByText(/Connected as @someone-else/)).toBeTruthy();
    relayState.me = { handle: 'jmq' };
  });
});
