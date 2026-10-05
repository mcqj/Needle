import { atom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const localStorageAdapter = createJSONStorage(() => localStorage);

/**
 * The relay's own echo account, used by the integration self-test. Its traffic
 * proves the loop works but belongs to no person, so it is kept aside rather
 * than mixed in with what friends sent.
 */
export const RELAY_TEST_HANDLE = 'relay-echo';

export function isTestHandle(handle) {
  return handle === RELAY_TEST_HANDLE;
}

/**
 * Listens other people sent. These are deliberately NOT part of libraryAtom:
 * they are someone else's data, so they never count toward the ledger's totals,
 * categories, or sort order until the user explicitly adds one.
 */
export const receivedTracksAtom = atomWithStorage(
  'needle-received-listens',
  [],
  localStorageAdapter,
  { getOnInit: true },
);

/**
 * What this app sent, newest first. A send finishes in the background and the
 * card that started it may be gone by then, so the outcome is kept here rather
 * than only on screen: "did they get it?" has to be answerable later.
 */
export const sentTracksAtom = atomWithStorage(
  'needle-sent-listens',
  [],
  localStorageAdapter,
  { getOnInit: true },
);

/** Plain notes between contacts, stored here — the relay does not keep them. */
export const chatThreadsAtom = atomWithStorage(
  'needle-conversations',
  {},
  localStorageAdapter,
  { getOnInit: true },
);

/** Contacts whose conversation is open on the friends screen. */
export const activePeerAtom = atom('');

/** Received listens, split into what friends sent and what the self-test did. */
export const receivedFromPeopleAtom = atom((get) => (
  get(receivedTracksAtom).filter((item) => !isTestHandle(item.from))
));

export const receivedFromTestsAtom = atom((get) => (
  get(receivedTracksAtom).filter((item) => isTestHandle(item.from))
));

export const unseenReceivedCountAtom = atom((get) => (
  get(receivedFromPeopleAtom).filter((item) => !item.seen).length
));

export const activeThreadAtom = atom((get) => {
  const peer = get(activePeerAtom);
  if (!peer) return [];
  return get(chatThreadsAtom)[peer] || [];
});
