// Type declarations for the 1-z-2 SDK (client.js). Hand-maintained; the
// runtime file is the source of truth and these follow its public surface.
// Same licence as client.js: use and embed freely, unmodified.

/** Version of the SDK file. Sent on every request; the relay answers with its current one. */
export const SDK_VERSION: string;

/** A relay handle without the leading "@", e.g. "ana". */
export type Handle = string;

export type Direction = "send" | "receive";

/**
 * The exported identity: everything needed to be this handle again on another
 * device or origin. Treat it as a secret — there is no password reset behind it.
 */
export interface Credentials {
  handle?: Handle;
  relayUrl?: string;
  token: string;
  appId?: string;
  publicKeyPem?: string;
  alg?: string;
  /** Account key (present in the first app and in exports from it). */
  privateJwk?: JsonWebKey;
  /** Device key of a paired app. */
  deviceKeyPem?: string;
  deviceAlg?: string;
  devicePrivateJwk?: JsonWebKey;
  signingEnforced?: boolean;
}

export interface ConnectOptions {
  handle: Handle;
  /** Defaults to http://localhost:8484. */
  relayUrl?: string;
  /** Required while the relay is invite-only. Used once, at registration, never stored. */
  invite?: string;
  /** The id of a web-fallback page that authorises claiming the one handle it was addressed to. */
  fallbackId?: string;
  /** Node only: where credentials are read and written. Defaults to `.relay-<handle>.json`. */
  credentialsFile?: string;
}

export interface PublishOptions {
  /** Short kebab-case noun for the concept, e.g. "workout". */
  name: string;
  direction: Direction;
  /** What the data MEANS, in plain language — matching is by meaning, not name. */
  description: string;
  /** Optional explicit JSON schema. Prefer `example`: the relay infers the schema. */
  schema?: Record<string, unknown>;
  /** One real object exactly as this app stores it. */
  example?: unknown;
  /** Several real objects, if one cannot show the shape. */
  examples?: unknown[];
  /**
   * Send capabilities only: false keeps this out of contacts' updates feeds
   * (it still works). Sticky — omit it to leave the current setting alone.
   */
  announce?: boolean;
}

/** One entry in the updates feed — something a contact's app can send. */
export interface Update {
  from: Handle;
  /** The contact's app label, when it has one. */
  app: string | null;
  name: string;
  description: string;
  kind: "added" | "changed";
  /** Milliseconds since epoch; null for features older than the feed. */
  at: number | null;
  /** Can this handle receive it today? "missing" = nothing here takes it yet. */
  yours: "ready" | "missing" | "unknown";
  /** The receive capability it lands as, when `yours` is "ready". */
  landsAs: string | null;
}

export interface SendOptions {
  /** ≤128 chars, unique per composed message. Reuse the SAME key when retrying the SAME message. */
  idempotencyKey?: string;
}

export interface SendResult {
  /** Message id — pass to waitSent() / sentStatus(). */
  id: string;
  /**
   * "queued": delivered to the recipient's inbox.
   * "compiling": first exchange between these two shapes; poll waitSent(id) in the background.
   * "web-fallback": the recipient has no app; the message became a web page.
   */
  delivery: "queued" | "compiling" | "web-fallback";
  /** Present for web-fallback deliveries: the page to share with the recipient. */
  page?: string;
  [key: string]: unknown;
}

export type SentStatus = "compiling" | "queued" | "delivered" | "failed" | "expired";

export interface SentMessage {
  id: string;
  status: SentStatus;
  /**
   * With status "failed": why. With status queued/delivered: graceful failure —
   * the relay delivered your exact bytes with the failure declared.
   */
  error?: string;
  [key: string]: unknown;
}

/** The relay's account of what it did to a received message (D9). */
export interface Provenance {
  /** True when the payload is NOT the bytes the sender sent — the relay rewrote it into this app's shape. */
  translated: boolean;
  /** The sender's name for the capability. */
  sentAs?: string;
  match?: unknown;
  /** What the sender's payload had and this one does not. */
  dropped?: string[];
  /** What this payload states that the sender never said. */
  assumed?: string[];
  original?: unknown;
  /** Set on graceful failure: translation could not be compiled; payload is the sender's exact bytes. */
  failure?: string;
  note?: string;
  /** Relay-hosted human-readable page for an untranslated payload (path; prefix with relayUrl). */
  page?: string;
}

export interface ReceivedMessage<T = unknown> {
  id: string;
  from_handle: Handle;
  /** The recipient-side capability name. Relay system events are "relay:*" and never reach onReceive handlers. */
  type: string;
  /** Already in THIS app's shape — but it is another person's data. */
  payload: T;
  provenance?: Provenance;
  [key: string]: unknown;
}

export type ProvenanceSummary =
  | { kind: "plain" }
  | {
      kind: "translated";
      /** e.g. `translated from "meal-idea"` — show quietly. */
      badge: string;
      dropped: string[];
      assumed: string[];
      /** "See what they sent." */
      fetchOriginal: () => Promise<MessageOriginal>;
    }
  | {
      kind: "untranslated";
      note: string;
      failure: string;
      /** Absolute URL of the relay-hosted readable page, or null. */
      page: string | null;
    };

export interface MessageOriginal {
  from: Handle;
  sentAs: string;
  original: unknown;
  receivedAs: string;
  received: unknown;
  provenance: Provenance;
  sentAt: string;
  [key: string]: unknown;
}

export interface ContactRequestResult {
  to: Handle;
  status: "pending" | "already-accepted";
}

/** One person the relay could introduce this user to (see introductions()). */
export interface Suggestion {
  handle: Handle;
  /** The mutual friend(s) the introduction would come through. */
  via: Handle[];
  /** What their app can send today (announced send capabilities). */
  sends: Array<{ name: string; description: string }>;
}

export interface Introductions {
  /** This user's own switch. Off by default; suggestions are empty while off. */
  open: boolean;
  suggestions: Suggestion[];
}

export interface Roster {
  contacts: Array<{ handle: Handle; [key: string]: unknown }>;
  /** `via`: the mutual friend this request was introduced through, when it was. */
  incoming: Array<{ handle?: Handle; from?: Handle; via?: Handle | null; [key: string]: unknown }>;
  outgoing: Array<{ handle?: Handle; to?: Handle; [key: string]: unknown }>;
  blocked: Array<{ handle: Handle; [key: string]: unknown }>;
}

export interface SelfTestStep {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface SelfTestResult {
  ok: boolean;
  steps: SelfTestStep[];
}

export interface OnReceiveOptions {
  /** Called instead of console.error when a handler throws or the inbox poll fails. `msg` is null for poll failures. */
  onError?: (err: unknown, msg: ReceivedMessage | null) => void;
  /** Pass false to force long-polling instead of push (SSE). Default true. */
  push?: boolean;
}

export interface SyncContactsHandle {
  refresh: () => Promise<void>;
  stop: () => void;
}

/** Error thrown by relay calls: the relay's message plus the HTTP status. */
export interface RelayError extends Error {
  status?: number;
}

export class RelayClient {
  handle: Handle;
  relayUrl: string;
  token: string | null;
  publicKeyPem: string | undefined;
  appId?: string;

  constructor(init: { handle: Handle; relayUrl: string; token: string; publicKeyPem?: string });

  /** Register the handle on first run, or reuse locally stored credentials. */
  static connect(options: ConnectOptions): Promise<RelayClient>;

  /** Re-issue a token from the stored keypair when the token is gone or stolen. */
  static recover(options: { handle: Handle; relayUrl?: string; credentialsFile?: string }): Promise<RelayClient>;

  /** Pair a NEW app onto a handle you already own, authorised by the account key. */
  static pairApp(options: {
    handle: Handle;
    relayUrl?: string;
    /** Node: the existing app's credentials file (where the account key is read from). */
    accountCredentialsFile?: string;
    /** Node: where THIS app's new credentials are written. */
    credentialsFile?: string;
    label?: string;
  }): Promise<RelayClient>;

  /** Install an identity exported elsewhere (or downloaded at claim time) into this context's store. */
  static importCredentials(options: {
    handle?: Handle;
    credentials: Credentials;
    credentialsFile?: string;
  }): Promise<{ handle: Handle; imported: true }>;

  /** Ask the relay to mail a recovery code. Same response whether or not an email is bound. */
  static requestEmailRecovery(options: { handle: Handle; relayUrl?: string }): Promise<Record<string, unknown>>;

  /** Trade a mailed recovery code for a fresh identity; every other app's token is revoked. */
  static recoverByEmail(options: {
    handle: Handle;
    code: string;
    relayUrl?: string;
    credentialsFile?: string;
  }): Promise<RelayClient>;

  // ---- identity and apps ----

  /** This handle's apps (label, requireSigning, which one is current). */
  apps(): Promise<Record<string, unknown>>;
  /** The stored credentials, key material included — the portable identity. */
  exportCredentials(): Promise<Credentials & { handle: Handle; relayUrl: string }>;
  /** Rotate this app's device (signing) key. */
  rotateDeviceKey(): Promise<{ rotated: true }>;
  /** Require signed requests for this app (default true). */
  requireSigning(enable?: boolean): Promise<Record<string, unknown>>;
  /** Swap the bearer token for a fresh one and persist it. */
  rotateToken(): Promise<string>;
  /** Start binding a recovery email; finish with verifyEmail(code). */
  bindEmail(email: string): Promise<Record<string, unknown>>;
  verifyEmail(code: string): Promise<Record<string, unknown>>;
  unbindEmail(): Promise<Record<string, unknown>>;
  /** Delete the account for good. The handle is retired, not freed. */
  deleteAccount(): Promise<Record<string, unknown>>;

  // ---- billing ----

  /** Current tier, subscription status, and today's usage against each ceiling. */
  billing(): Promise<Record<string, unknown>>;
  /** Start a paid plan; answers a Stripe-hosted checkout URL. */
  billingCheckout(plan: "plus" | "pro"): Promise<{ url: string }>;
  /** Stripe's portal page for an existing subscription. */
  billingPortal(): Promise<{ url: string }>;

  // ---- capabilities ----

  /** Declare something this app can send or receive. Call again on every app start. */
  publish(options: PublishOptions): Promise<Record<string, unknown>>;
  unpublish(name: string, direction: Direction): Promise<Record<string, unknown>>;
  /** Show or hide a send capability in contacts' updates feeds. */
  setAnnounce(name: string, announce: boolean): Promise<{ name: string; announce: boolean }>;
  /** What this handle's contacts can now send, newest first. */
  updates(): Promise<{ updates: Update[] }>;
  /** Paste-to-your-AI instruction for adding a contact's feature to this app. */
  featurePrompt(update: Pick<Update, "from" | "name" | "description">): string;
  /** Conversation pillar: publish the standard "chat" pair. `enabled: false` when another of the user's apps already carries it. */
  enableChat(): Promise<{ enabled: boolean; reason?: string }>;
  /** Send a plain-text note to a contact (after enableChat()). */
  sendChat(to: Handle, text: string, options?: { idempotencyKey?: string }): Promise<SendResult>;
  /** This handle's own capabilities, full detail. */
  capabilities(): Promise<{ capabilities: Array<Record<string, unknown>> }>;

  // ---- contacts ----

  /** Ask to connect. `via` names the mutual friend an introduction came through — only a handle from introductions() is accepted. */
  requestContact(to: Handle, message?: string, options?: { via?: Handle }): Promise<ContactRequestResult>;
  /** Opt-in introductions: who this user could be introduced to, through which mutual friend. */
  introductions(): Promise<Introductions>;
  /** Turn introductions on or off for this handle (off by default). */
  setIntroductions(open: boolean): Promise<{ open: boolean }>;
  pendingRequests(): Promise<Record<string, unknown>>;
  acceptContact(from: Handle): Promise<Record<string, unknown>>;
  declineContact(from: Handle): Promise<Record<string, unknown>>;
  blockContact(handle: Handle): Promise<Record<string, unknown>>;
  unblockContact(handle: Handle): Promise<Record<string, unknown>>;
  removeContact(handle: Handle): Promise<Record<string, unknown>>;
  /** Full roster: { contacts, incoming, outgoing, blocked }. */
  contacts(): Promise<Roster>;
  /** Handler for the relay event sent when a contact request this handle made is accepted. Needs onReceive running. */
  onContactAccepted(handler: (event: { event?: string; handle: Handle; [key: string]: unknown }) => void | Promise<void>): void;
  /** Fetch the roster now, again on every accept event, and on a slow fallback poll. */
  syncContacts(onRoster: (roster: Roster) => void, options?: { pollMs?: number }): SyncContactsHandle;
  /** Public directory entry for a handle. */
  lookup(handle: Handle): Promise<Record<string, unknown>>;

  // ---- sending ----

  /** Send a payload in THIS app's shape; the relay translates. Never block the UI on the result. */
  send(to: Handle, type: string, payload: unknown, options?: SendOptions): Promise<SendResult>;
  sentStatus(id: string): Promise<SentMessage>;
  /** Poll until a parked message finishes compiling. Resolves with status "failed" on failure; throws only on timeout. */
  waitSent(id: string, options?: { intervalMs?: number; timeoutMs?: number }): Promise<SentMessage>;

  // ---- receiving ----

  /**
   * Receive messages: handler per message, acked on success. Returns a stop
   * function. A handler that throws leaves the message unacked (at-least-once).
   */
  onReceive<T = unknown>(
    handler: (msg: ReceivedMessage<T>) => void | Promise<void>,
    options?: OnReceiveOptions,
  ): () => void;
  /** One batch of queued messages (not acked). */
  inbox<T = unknown>(): Promise<Array<ReceivedMessage<T>>>;
  /** One batch plus whether more are waiting. */
  inboxBatch<T = unknown>(options?: { limit?: number }): Promise<{ messages: Array<ReceivedMessage<T>>; more: boolean }>;
  ack(ids: string[]): Promise<Record<string, unknown>>;
  /** Pre-decided rendering instructions for one received message's provenance. */
  provenanceSummary(msg: ReceivedMessage): ProvenanceSummary;
  /** What the sender actually sent beside what you received. Throws 410 once the body has expired. */
  messageOriginal(id: string): Promise<MessageOriginal>;

  // ---- history, routing, retention ----

  /** Message log, both directions, newest first; metadata and provenance, never bodies. */
  messages(options?: { limit?: number; before?: string | number }): Promise<{ messages: Array<Record<string, unknown>>; nextBefore?: string | number | null }>;
  /** Every contract this handle is party to, with the compiled transform serving it. */
  contracts(): Promise<Record<string, unknown>>;
  /** What the relay holds for this handle right now and when it stops holding it. */
  retention(): Promise<Record<string, unknown>>;
  /** Correct a translation delivered TO you, in plain language or as transform code. */
  correctTranslation(options: {
    from: Handle;
    type: string;
    correction?: string;
    code?: string;
    clear?: boolean;
  }): Promise<Record<string, unknown>>;

  // ---- verification ----

  /** Prove the whole loop against @relay-echo. Never throws; a failed step is reported in `steps`. */
  selfTest(options?: { timeoutMs?: number }): Promise<SelfTestResult>;
}
