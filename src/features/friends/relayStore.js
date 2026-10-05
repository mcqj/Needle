import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'jotai';
import { connectRelay, HANDLE, relayCall, retryConnection, setInboundHandler } from './relay-client';
import { chatThreadsAtom, receivedTracksAtom, sentTracksAtom } from '../../state/friendsAtoms';
import { libraryAtom } from '../../state/libraryAtoms';

function makeId() {
  return globalThis.crypto?.randomUUID?.()
    || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * A received payload is only usable as a listen when it looks like one. The
 * relay translates other apps' shapes into Needle's, but an untranslated
 * payload is the sender's own bytes and must not be rendered as local data.
 */
function looksLikeTrack(payload) {
  return Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (payload.url || payload.title),
  );
}

/**
 * Store the provenance decision as plain data. `fetchOriginal` is a function
 * on the SDK's summary, so it cannot be persisted; keep the message id instead
 * and ask the relay again when the user wants to see the sender's version.
 */
export function serialiseProvenance(relay, msg) {
  let summary;
  try {
    summary = relay.provenanceSummary(msg);
  } catch {
    return { kind: 'plain', messageId: msg.id };
  }

  if (summary.kind === 'translated') {
    return {
      kind: 'translated',
      messageId: msg.id,
      badge: summary.badge,
      dropped: summary.dropped || [],
      assumed: summary.assumed || [],
    };
  }
  if (summary.kind === 'untranslated') {
    return {
      kind: 'untranslated',
      messageId: msg.id,
      note: summary.note || '',
      failure: summary.failure || '',
      page: summary.page || null,
    };
  }
  return { kind: 'plain', messageId: msg.id };
}

// ---- send status -----------------------------------------------------------
//
// Sending never blocks. Each item keeps its own small state machine, keyed by
// message id, and the component showing that item subscribes to it.

const sendStates = new Map();
const sendListeners = new Set();

function setSendState(id, next) {
  sendStates.set(id, next);
  for (const listener of sendListeners) listener();
}

export function getSendState(id) {
  return sendStates.get(id) || null;
}

function subscribeSendState(listener) {
  sendListeners.add(listener);
  return () => sendListeners.delete(listener);
}

/** Subscribe to one message's send state, so a card can show "sending…". */
export function useSendState(id) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    return subscribeSendState(() => force((n) => n + 1));
  }, [id]);
  return id ? getSendState(id) : null;
}

export const SEND_COPY = {
  queued: 'Sent',
  compiling: 'Setting up',
  delivered: 'Sent',
  failed: 'Not sent',
  expired: 'Expired',
  unknown: 'Not sure',
};

// ---- the bridge -------------------------------------------------------------

/**
 * The single wiring point between the relay and the app's own state. Mounted
 * once, by the friends provider.
 */
export function useRelayBridge() {
  const store = useStore();

  useEffect(() => {
    connectRelay();
  }, []);

  useEffect(() => setInboundHandler(async (relay, msg) => {
    const provenance = serialiseProvenance(relay, msg);
    const receivedAt = nowIso();

    if (msg.type === 'chat') {
      const peer = msg.from_handle;
      const text = typeof msg.payload?.text === 'string' ? msg.payload.text : '';
      if (!text) return;
      store.set(chatThreadsAtom, (threads) => {
        const thread = threads[peer] || [];
        if (thread.some((note) => note.id === msg.id)) return threads;
        return {
          ...threads,
          [peer]: [
            ...thread,
            { id: msg.id, direction: 'in', text, sentAt: msg.payload?.sentAt || receivedAt },
          ],
        };
      });
      return;
    }

    const isTrack = msg.type === 'saved-listen' || looksLikeTrack(msg.payload);

    store.set(receivedTracksAtom, (items) => {
      if (items.some((item) => item.id === msg.id)) return items;
      const base = { id: msg.id, from: msg.from_handle, receivedAt, seen: false, provenance };
      return [
        isTrack
          ? { ...base, track: msg.payload }
          : { ...base, unknownType: msg.type, payload: msg.payload },
        ...items,
      ];
    });

    // The relay only delivers consented mail, so the sender is a real contact
    // even if the rendered roster is a moment behind. Refresh it.
    relayCall('contacts', (client) => client.contacts());
  }), [store]);
}

// ---- actions ----------------------------------------------------------------

/**
 * Every relay action the interface needs, in one object. Reads the connection
 * lazily so a relay outage leaves these as no-ops rather than crashes.
 */
export function useRelayActions() {
  const store = useStore();

  /** Add or update the lasting record of one send. */
  const recordSend = useCallback((idempotencyKey, changes) => {
    store.set(sentTracksAtom, (current) => {
      const existing = current.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (!existing) return [{ idempotencyKey, sentAt: nowIso(), ...changes }, ...current];
      return current.map((entry) => (
        entry.idempotencyKey === idempotencyKey ? { ...entry, ...changes } : entry
      ));
    });
  }, [store]);

  /**
   * Ask the relay which capability of theirs our item landed as. Best effort:
   * the receipt is still useful without it.
   */
  const findLanding = useCallback(async (handle) => {
    const result = await relayCall('contracts', (relay) => relay.contracts());
    const contract = result?.contracts?.find((entry) => (
      entry.from === HANDLE && entry.to === handle && entry.sentAs === 'saved-listen'
    ));
    return contract?.deliveredAs || null;
  }, []);

  const sendTrack = useCallback(async (handle, track, options = {}) => {
    // A retry reuses the same idempotency key, so it cannot deliver twice.
    const idempotencyKey = options.idempotencyKey || makeId();
    const relay = await connectRelay();
    if (!relay) {
      const localId = `offline-${idempotencyKey}`;
      setSendState(localId, { status: 'failed', error: 'The relay could not be reached.', idempotencyKey });
      recordSend(idempotencyKey, { handle, track, status: 'failed', error: 'The relay could not be reached.' });
      return { id: localId, delivery: 'failed' };
    }

    // Show "sending…" on the item itself before the relay has answered.
    setSendState(idempotencyKey, { status: 'sending', idempotencyKey, handle, track });
    recordSend(idempotencyKey, { handle, track, status: 'sending' });

    let result;
    try {
      result = await relay.send(handle, 'saved-listen', track, { idempotencyKey });
    } catch (error) {
      const message = error.message || String(error);
      setSendState(idempotencyKey, { status: 'failed', idempotencyKey, error: message });
      recordSend(idempotencyKey, { status: 'failed', error: message });
      return { id: idempotencyKey, delivery: 'failed' };
    }

    const state = { idempotencyKey, handle, track, delivery: result.delivery };
    if (result.delivery === 'queued') {
      setSendState(idempotencyKey, { ...state, status: 'sent', messageId: result.id });
      findLanding(handle).then((arrivedAs) => recordSend(idempotencyKey, { status: 'sent', messageId: result.id, arrivedAs }));
    } else if (result.delivery === 'web-fallback') {
      setSendState(idempotencyKey, { ...state, status: 'sent', messageId: result.id, page: result.page });
      recordSend(idempotencyKey, { status: 'sent', messageId: result.id, page: result.page, webFallback: true });
    } else {
      // First exchange between these two shapes: the relay is compiling a
      // translation. Finish in the background and keep the UI usable.
      setSendState(idempotencyKey, { ...state, status: 'compiling', messageId: result.id });
      recordSend(idempotencyKey, { status: 'compiling', messageId: result.id });
      relay
        .waitSent(result.id)
        .then((sent) => {
          if (sent.status === 'failed') {
            setSendState(idempotencyKey, {
              ...state,
              status: 'failed',
              messageId: result.id,
              error: sent.error || 'The relay could not deliver this.',
            });
            recordSend(idempotencyKey, {
              status: 'failed',
              messageId: result.id,
              error: sent.error || 'The relay could not deliver this.',
            });
          } else if (sent.status === 'expired') {
            setSendState(idempotencyKey, { ...state, status: 'expired', messageId: result.id });
            recordSend(idempotencyKey, { status: 'expired', messageId: result.id });
          } else {
            setSendState(idempotencyKey, { ...state, status: 'sent', messageId: result.id });
            findLanding(handle).then((arrivedAs) => recordSend(idempotencyKey, { status: 'sent', messageId: result.id, arrivedAs }));
          }
        })
        .catch(() => {
          setSendState(idempotencyKey, { ...state, status: 'unknown', messageId: result.id });
          recordSend(idempotencyKey, { status: 'unknown', messageId: result.id });
        });
    }

    return { ...result, idempotencyKey };
  }, [recordSend, findLanding]);

  /** Retry a failed send of the same message, reusing its idempotency key. */
  const retrySend = useCallback(async (key) => {
    const state = getSendState(key);
    if (state?.handle && state?.track) {
      return sendTrack(state.handle, state.track, { idempotencyKey: key });
    }
    // Nothing in memory — the page was reloaded, or the card is long gone. The
    // saved receipt is enough to send the same message again, and the reused
    // idempotency key still means it cannot deliver twice.
    const receipt = store.get(sentTracksAtom).find((entry) => entry.idempotencyKey === key);
    if (receipt?.handle && receipt?.track) {
      return sendTrack(receipt.handle, receipt.track, { idempotencyKey: key });
    }
    return null;
  }, [sendTrack, store]);

  const checkSend = useCallback(async (key) => {
    const state = getSendState(key);
    if (!state?.messageId) return null;
    const sent = await relayCall('sentStatus', (relay) => relay.sentStatus(state.messageId));
    if (!sent) return null;
    if (sent.status === 'failed') {
      setSendState(key, { ...state, status: 'failed', error: sent.error || 'Still not delivered.' });
      recordSend(key, { status: 'failed', error: sent.error || 'Still not delivered.' });
    } else if (sent.status === 'delivered' || sent.status === 'queued') {
      setSendState(key, { ...state, status: 'sent' });
      recordSend(key, { status: 'sent' });
      findLanding(state.handle).then((arrivedAs) => recordSend(key, { status: 'sent', arrivedAs }));
    } else if (sent.status === 'expired') {
      setSendState(key, { ...state, status: 'expired' });
      recordSend(key, { status: 'expired' });
    }
    return sent;
  }, [recordSend, findLanding]);

  const requestContact = useCallback((handle, note, options) => (
    relayCall('requestContact', (relay) => relay.requestContact(handle, note, options))
  ), []);

  const acceptContact = useCallback((handle) => (
    relayCall('acceptContact', (relay) => relay.acceptContact(handle))
  ), []);

  const declineContact = useCallback((handle) => (
    relayCall('declineContact', (relay) => relay.declineContact(handle))
  ), []);

  const sendChat = useCallback(async (handle, text) => {
    const localId = makeId();
    const sentAt = nowIso();
    const note = { id: localId, direction: 'out', text, sentAt, pending: true };

    // The note is written into the thread first, so an unreachable relay can
    // never swallow it. The relay does not store threads; this copy is the only
    // one, and a pending note is retried when the connection returns.
    store.set(chatThreadsAtom, (threads) => ({
      ...threads,
      [handle]: [...(threads[handle] || []), note],
    }));

    const result = await relayCall('sendChat', (relay) => relay.sendChat(handle, text));
    store.set(chatThreadsAtom, (threads) => ({
      ...threads,
      [handle]: (threads[handle] || []).map((entry) => (
        entry.id === localId
          ? { ...entry, pending: !result, relayId: result?.id }
          : entry
      )),
    }));
    return result ? { ...result, localId } : null;
  }, [store]);

  /** Push any notes written while the relay was unreachable. */
  const flushPendingChat = useCallback(async () => {
    const threads = store.get(chatThreadsAtom);
    const pending = [];
    for (const [handle, notes] of Object.entries(threads)) {
      for (const note of notes) {
        if (note.direction === 'out' && note.pending) pending.push({ handle, note });
      }
    }
    for (const { handle, note } of pending) {
      const result = await relayCall('sendChat', (relay) => relay.sendChat(handle, note.text));
      if (!result) continue;
      store.set(chatThreadsAtom, (current) => ({
        ...current,
        [handle]: (current[handle] || []).map((entry) => (
          entry.id === note.id ? { ...entry, pending: false, relayId: result.id } : entry
        )),
      }));
    }
    return pending.length;
  }, [store]);

  const addToLibrary = useCallback((item) => {
    const newId = makeId();
    store.set(libraryAtom, (current) => {
      const track = item.track || {};
      return [
        ...current,
        {
          ...track,
          id: newId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          // Attribution travels with the copy, so an imported listen can always
          // say who recommended it.
          fromHandle: item.from,
          receivedAt: item.receivedAt,
        },
      ];
    });
    store.set(receivedTracksAtom, (items) => items.map((entry) => (
      entry.id === item.id ? { ...entry, importedTrackId: newId } : entry
    )));
    return newId;
  }, [store]);

  const markReceivedSeen = useCallback(() => {
    store.set(receivedTracksAtom, (items) => (
      items.some((item) => !item.seen)
        ? items.map((item) => (item.seen ? item : { ...item, seen: true }))
        : items
    ));
  }, [store]);

  /** Mark every entry in the "sent" list as looked at. */
  const markSendSeen = useCallback(() => {
    store.set(sentTracksAtom, (items) => (
      items.some((item) => !item.seen)
        ? items.map((item) => (item.seen ? item : { ...item, seen: true }))
        : items
    ));
  }, [store]);

  const loadOriginal = useCallback((messageId) => (
    relayCall('messageOriginal', (relay) => relay.messageOriginal(messageId))
  ), []);

  return {
    sendTrack,
    retrySend,
    checkSend,
    requestContact,
    acceptContact,
    declineContact,
    sendChat,
    flushPendingChat,
    addToLibrary,
    markReceivedSeen,
    markSendSeen,
    loadOriginal,
    retryConnection,
  };
}
