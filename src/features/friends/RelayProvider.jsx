import { useEffect, useRef } from 'react';
import { RelayContext, useRelayState } from './useRelay';
import { useRelayActions, useRelayBridge } from './relayStore';

/**
 * Mounted once above the router. Keeping the bridge here (not on the friends
 * screen) means a friend's message surfaces wherever the user happens to be,
 * and the conversation keeps arriving while they browse their ledger.
 */
export default function RelayProvider({ children }) {
  useRelayBridge();
  const actions = useRelayActions();
  const { connection } = useRelayState();
  const wasOnline = useRef(false);

  // Notes written while the relay was unreachable go out once it is back.
  useEffect(() => {
    if (connection.state === 'online' && !wasOnline.current) {
      wasOnline.current = true;
      actions.flushPendingChat();
    }
    if (connection.state !== 'online') wasOnline.current = false;
  }, [connection.state, actions]);

  return <RelayContext.Provider value={actions}>{children}</RelayContext.Provider>;
}
