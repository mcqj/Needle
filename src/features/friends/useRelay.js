import { createContext, useContext, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './relay-client';
import { useRelayActions } from './relayStore';

export const RelayContext = createContext(null);

/**
 * Read-only relay state. Subscribes straight to the plumbing module, so the
 * connection snapshot updates wherever it is displayed.
 */
export function useRelayState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Relay actions for the send buttons, available anywhere in the tree. Falls
 * back to a private instance outside the provider so a stray render can never
 * take the ledger down.
 */
export function useRelayActionsContext() {
  const fromContext = useContext(RelayContext);
  const fallback = useRelayActions();
  return fromContext || fallback;
}

export function useRelayReady() {
  const { connection } = useRelayState();
  return connection.state === 'online';
}
