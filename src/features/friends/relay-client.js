// Every byte of 1-z-2 plumbing lives in this file. UI code talks to the
// functions below and never to the relay directly.
//
// The relay being unreachable is never fatal: connect() resolves to null, the
// friends area shows a plain retry, and the ledger itself is untouched.
import { RelayClient } from '../../../relay-client.js';

export const RELAY_URL = 'https://relay.1-z-2.com';

const CREDENTIAL_PREFIX = 'relay:';

/**
 * The identity file served by the dev endpoint. Only consulted when that
 * endpoint does not say which file it served; the handle itself always comes
 * from the filename or the credentials.
 */
const DEV_IDENTITY_FILE = import.meta.env?.VITE_RELAY_IDENTITY_FILE || '.relay-identity.json';

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

const me = { handle: null, relayUrl: RELAY_URL, publicKeyPem: undefined };
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

/**
 * The handle this browser holds credentials for, or null.
 *
 * The SDK stores credentials under `relay:<handle>`, so the handle is the one
 * thing that cannot be looked up without already knowing it. Reading the keys
 * finds it instead, which is what lets the rest of the app derive the handle
 * rather than be configured with it.
 */
export function storedHandle() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) || '';
      if (key.startsWith(CREDENTIAL_PREFIX) && key.length > CREDENTIAL_PREFIX.length) {
        return key.slice(CREDENTIAL_PREFIX.length);
      }
    }
  } catch {
    // Private mode, or storage disabled. Treated as "no identity".
  }
  return null;
}

/** True when this browser context already holds credentials. */
export function hasStoredIdentity() {
  return Boolean(storedHandle());
}

export function hasWebCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

/**
 * The handle an identity file denotes, or null.
 *
 * The exported credentials do not always carry a `handle` field — the ones the
 * relay's website writes do not — so the filename is the reliable source. Per
 * the integration spec it is always `.relay-<handle>.json`.
 */
export function handleFromFilename(filename = '') {
  const match = String(filename).match(/\.relay-([a-z0-9-]+)\.json$/i);
  return match ? match[1] : null;
}

/**
 * An identity handed to the app rather than stored: a JSON script element (a
 * build can inline the export there), or the dev-only endpoint that serves the
 * project's identity file over the local origin.
 *
 * The handle comes out of whatever was given, never assumed, so a build works
 * with whichever identity it was handed.
 */
async function providedIdentity() {
  if (typeof document !== 'undefined') {
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const id = script.getAttribute('id') || '';
      if (id === 'relay-identity' || id.startsWith('relay-identity-')) {
        try {
          const credentials = JSON.parse(script.textContent);
          // No filename to read here, so an inlined export has to carry it.
          if (!credentials.handle) {
            log('inline identity names no handle');
            continue;
          }
          return credentials;
        } catch {
          log('inline identity is not valid JSON');
        }
      }
    }
  }

  try {
    const response = await fetch('/.relay-identity', { cache: 'no-store' });
    if (!response.ok) return null;
    const credentials = await response.json();
    // The dev endpoint serves `.relay-<handle>.json`, so fall back to its name.
    const served = response.headers.get('x-identity-file') || DEV_IDENTITY_FILE;
    return { ...credentials, handle: credentials.handle || handleFromFilename(served) };
  } catch {
    // No endpoint in a build, or offline. The import input covers it.
  }
  return null;
}

/**
 * Get the handle's identity into this browser context BEFORE the first connect,
 * per the integration spec: connect() must reuse credentials, never register the
 * handle fresh.
 *
 * If nothing is available, the friends screen offers an "import identity file"
 * input, which feeds the same importCredentials call.
 */
export async function ensureIdentity() {
  if (hasStoredIdentity()) return { seeded: false, reason: 'already-stored', handle: storedHandle() };

  const credentials = await providedIdentity();
  if (!credentials?.token) return { seeded: false, reason: 'no-identity-file', handle: null };
  if (!credentials.handle) {
    return { seeded: false, reason: 'identity-has-no-handle', handle: null };
  }

  await RelayClient.importCredentials({ handle: credentials.handle, credentials });
  log('identity imported for', credentials.handle);
  return { seeded: true, reason: 'imported', handle: credentials.handle };
}

/**
 * Same import, driven by the browser's file input. The handle is taken from the
 * file's name (`.relay-<handle>.json`) or, failing that, from a `handle` field,
 * so the app never has to be told who it is.
 */
export async function importIdentityFile(file) {
  const credentials = JSON.parse(await file.text());
  const handle = credentials.handle || handleFromFilename(file.name);
  if (!handle) {
    throw new Error(
      `"${file.name}" does not look like a 1-z-2 identity file. Choose the .relay-<handle>.json file saved when the handle was registered.`,
    );
  }
  await RelayClient.importCredentials({ handle, credentials });
  await retryConnection();
  log('identity imported from the file picker for', handle);
  return handle;
}

// ---- connection -------------------------------------------------------------

async function createClient() {
  connection = { ...connection, state: 'connecting', error: '' };
  emit();

  // The identity is the source of truth for the handle: the credentials carry
  // it, so there is nothing to configure and nothing that can disagree with the
  // key those credentials authenticate.
  const seed = await ensureIdentity();
  if (!seed.seeded && seed.reason !== 'already-stored') {
    log(`no identity in this browser (${seed.reason})`);
  }

  const handle = seed.handle || storedHandle();
  if (!handle) {
    throw new Error(
      'No 1-z-2 identity in this browser. Import the .relay-<handle>.json file saved when your handle was registered.',
    );
  }

  const relay = await RelayClient.connect({ handle, relayUrl: RELAY_URL });

  me.handle = relay.handle;
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

/**
 * The handle behind the live connection, or null before one exists. Callers
 * that compare against "my own" handle should use this rather than a constant:
 * it is whatever identity this browser turned out to hold.
 */
export function myHandle() {
  return me.handle ?? liveClient?.handle ?? null;
}
