// Every byte of 1-z-2 plumbing lives in this file. UI code talks to the
// functions below and never to the relay directly.
//
// The relay being unreachable is never fatal: connect() resolves to null, the
// friends area shows a plain retry, and the ledger itself is untouched.
import { RelayClient } from '../../../relay-client.js';

export const RELAY_URL = 'https://relay.1-z-2.com';
export const HANDLE = 'jmq';

/**
 * The concept Needle exchanges. The example is a real object in the app's own
 * shape (see libraryAtom) with representative values, not a real person's
 * record. The relay infers the shape from it and adapts to other apps' shapes.
 */
const TRACK_EXAMPLE = {
  id: '0c2f5f3e-8a1d-4d2b-9a0e-2f6b1c7d4e55',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Blue Monday',
  artist: 'New Order',
  category: 'Post-punk',
  rating: 4,
  review: 'The drum machine that refuses to sit still.',
  imageUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  createdAt: '2024-11-02T09:14:00.000Z',
  updatedAt: '2024-11-02T09:14:00.000Z',
};

export const TRACK_SEND_CAPABILITY = {
  name: 'saved-listen',
  direction: 'send',
  description:
    'a music link saved in a personal listening ledger: title, artist, the URL, an optional category, a 0-5 rating, an optional review, and artwork',
  example: TRACK_EXAMPLE,
};

export const TRACK_RECEIVE_CAPABILITY = {
  name: 'saved-listen',
  direction: 'receive',
  description:
    'a music link someone recommends, kept as a suggestion in the listening ledger with title, artist, URL, category, rating, review and artwork',
  example: TRACK_EXAMPLE,
};

/** The capability name received listens land as, i.e. msg.type. */
export const RECEIVED_TRACK_TYPE = TRACK_RECEIVE_CAPABILITY.name;

const DEFAULT_ROSTER = { contacts: [], incoming: [], outgoing: [], blocked: [] };

// ---- module-level state -----------------------------------------------------
//
// One client per page load. React StrictMode mounts effects twice in
// development; the cached promise makes the second mount join the first
// instead of registering everything all over again.

let clientPromise = null;
let inboundWired = false;
let contactsSync = null;
let roster = DEFAULT_ROSTER;

// One stop function per client that is actually listening, so a client
// replaced by a retry cannot keep its receive loop running.
const receiveStops = new Map();

const me = { handle: HANDLE, relayUrl: RELAY_URL, publicKeyPem: undefined };
let connection = { state: 'idle', error: '', appId: undefined };
let liveClient = null;

const listeners = new Set();
const seenMessageIds = new Set();
let chatEnabled = null;

// ---- small helpers ----------------------------------------------------------

function log(...args) {
  console.info('[1-z-2]', ...args);
}

export function describeError(error) {
  if (!error) return 'Something went wrong.';
  if (isOfflineError(error)) {
    return 'The relay could not be reached. Check your connection and try again.';
  }
  return error.message || String(error);
}

export function isOfflineError(error) {
  return (
    error?.name === 'TypeError' ||
    /failed to fetch|networkerror|load failed|fetch failed/i.test(error?.message || '')
  );
}

/** True when this browser context already holds this handle's credentials. */
export function hasStoredIdentity() {
  try {
    return Boolean(globalThis.localStorage?.getItem(`relay:${HANDLE}`));
  } catch {
    return false;
  }
}

export function hasWebCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

function identityFileText() {
  if (typeof document === 'undefined') return null;
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const id = script.getAttribute('id') || '';
    if (id === `relay-identity-${HANDLE}` || id === 'relay-identity') return script.textContent;
  }
  return null;
}

/**
 * Get the handle's identity into this browser context BEFORE the first
 * connect, per the integration spec: connect() must reuse credentials, never
 * register the handle fresh. Two sources, both optional:
 *
 *  1. a `relay-identity[-<handle>]` JSON script element (a build can inline the
 *     export there), and
 *  2. the dev-only `/.relay-identity` endpoint that serves the project's
 *     `.relay-<handle>.json` file over the local origin.
 *
 * If neither is present, the friends screen offers an "import identity file"
 * input, which feeds the same importCredentials call.
 */
export async function ensureIdentity() {
  if (hasStoredIdentity()) return { seeded: false, reason: 'already-stored' };

  let credentials = null;
  const inline = identityFileText();
  if (inline) {
    try {
      credentials = JSON.parse(inline);
    } catch {
      log('inline identity is not valid JSON');
    }
  }

  if (!credentials) {
    try {
      const response = await fetch('/.relay-identity', { cache: 'no-store' });
      if (response.ok) credentials = await response.json();
    } catch {
      // No endpoint in a build, or offline. The import input covers it.
    }
  }

  if (!credentials?.token) return { seeded: false, reason: 'no-identity-file' };

  await RelayClient.importCredentials({ handle: credentials.handle || HANDLE, credentials });
  log('identity file imported into this browser');
  return { seeded: true, reason: 'imported' };
}

/** Same import, driven by the browser's file input. */
export async function importIdentityFile(file) {
  const text = await file.text();
  const credentials = JSON.parse(text);
  await RelayClient.importCredentials({ handle: credentials.handle || HANDLE, credentials });
  await retryConnection();
  log('identity file imported from the file picker');
  return credentials.handle || HANDLE;
}

// ---- connection -------------------------------------------------------------

async function createClient() {
  connection = { ...connection, state: 'connecting', error: '' };
  emit();

  if (!hasStoredIdentity()) {
    const seed = await ensureIdentity();
    if (!seed.seeded) log(`no identity in this browser (${seed.reason})`);
  }

  const relay = await RelayClient.connect({ handle: HANDLE, relayUrl: RELAY_URL });

  me.publicKeyPem = relay.publicKeyPem;
  liveClient = relay;
  connection = { ...connection, state: 'online', error: '', appId: relay.appId };
  log('connected', { handle: relay.handle, appId: relay.appId });
  emit();
  return relay;
}

export function connectRelay() {
  if (!clientPromise) {
    clientPromise = createClient()
      .then(async (relay) => {
        // A retry may have started a newer connection while this one was
        // connecting. Only the current client gets wired, so a stale client's
        // receive loop can never keep running in the background.
        if (liveClient === relay) await wire(relay);
        return relay;
      })
      .catch((error) => {
        clientPromise = null;
        liveClient = null;
        connection = {
          ...connection,
          state: isOfflineError(error) ? 'offline' : 'error',
          error: describeError(error),
        };
        log('connect failed:', connection.error);
        emit();
        return null;
      });
  }
  return clientPromise;
}

/** The live client, or null while offline. Never throws. */
export function getRelayClient() {
  return connectRelay();
}

export async function retryConnection() {
  // Stop whichever client is currently live, even if it finished connecting
  // after the last stopWiring() ran.
  await stopWiring();
  stopClient(liveClient);
  clientPromise = null;
  liveClient = null;
  connection = { ...connection, state: 'idle', error: '' };
  emit();
  return connectRelay();
}

/** Run a relay call without letting a relay problem break the app. */
export async function relayCall(label, run) {
  const relay = await getRelayClient();
  if (!relay) return null;
  try {
    return await run(relay);
  } catch (error) {
    log(`${label} failed:`, describeError(error));
    emit();
    return null;
  }
}

async function stopWiring() {
  stopClient(liveClient);
  inboundWired = false;
  try {
    contactsSync?.stop();
  } catch {
    // already stopped
  }
  contactsSync = null;
  roster = DEFAULT_ROSTER;
}

/** Detach from one client without touching the module's current state. */
function stopClient(client) {
  const stop = client && receiveStops.get(client);
  if (!stop) return;
  receiveStops.delete(client);
  try {
    stop();
  } catch {
    // already stopped
  }
}

// ---- what the relay can do for this app -------------------------------------

/**
 * Publish both directions of the concept and claim the shared "chat" pair.
 * Re-published on every app start so the relay stays current if the app is
 * regenerated with different shapes. Nothing here carries user data.
 */
export async function publishCapabilities(relay) {
  await relay.publish(TRACK_SEND_CAPABILITY);
  await relay.publish(TRACK_RECEIVE_CAPABILITY);
  log('published saved-listen (send + receive)');
}

async function enableChat(relay) {
  const chat = await relay.enableChat();
  chatEnabled = chat;
  if (!chat.enabled) {
    log('another of this handle\'s apps carries the conversations:', chat.reason || 'no reason given');
  }
  return chat;
}

async function wire(relay) {
  try {
    await publishCapabilities(relay);
  } catch (error) {
    log('publish failed:', describeError(error));
  }

  try {
    await enableChat(relay);
  } catch (error) {
    log('enableChat failed:', describeError(error));
  }

  startListening(relay);
  startContactsSync(relay);
  emit();
}

// ---- receiving --------------------------------------------------------------

const inboundHandlers = new Set();

/**
 * Handlers receive the live client plus every kept message, already in
 * Needle's own shape. They run once per message id, so a redelivered message
 * cannot double up.
 */
export function setInboundHandler(handler) {
  inboundHandlers.add(handler);
  return () => inboundHandlers.delete(handler);
}

function startListening(relay) {
  if (inboundWired) return;
  inboundWired = true;
  receiveStops.set(relay, relay.onReceive(
    async (msg) => {
      if (seenMessageIds.has(msg.id)) return;
      seenMessageIds.add(msg.id);
      if (seenMessageIds.size > 500) seenMessageIds.clear();
      for (const handler of inboundHandlers) {
        await handler(relay, msg);
      }
    },
    {
      onError: (error, msg) => {
        log(msg ? `handler failed for ${msg.id}:` : 'inbox poll failed:', describeError(error));
        // A message that failed to handle stays unacked on the relay, so it is
        // offered again on the next poll. Nothing is lost.
      },
    },
  ));
}

function startContactsSync(relay) {
  if (contactsSync) return;
  contactsSync = relay.syncContacts((next) => {
    roster = next;
    // Receiving always implies a consented contact, so fill the peer list from
    // whatever the roster knows without a second round trip.
    emit();
  });
}

export function refreshContacts() {
  return contactsSync?.refresh();
}

/** Contacts the user can send to right now, incoming requests excluded. */
export function contactHandles() {
  return roster.contacts.map((contact) => contact.handle).filter(Boolean);
}

export function isContact(handle) {
  return contactHandles().includes(handle);
}

// ---- subscription bookkeeping ----------------------------------------------

let snapshot = { me, connection, roster, chatEnabled, client: null };

function emit() {
  // useSyncExternalStore compares by identity, so hand out a new object only
  // when something actually changed.
  snapshot = { me, connection, roster, chatEnabled, client: liveClient };
  for (const listener of listeners) listener();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return snapshot;
}
