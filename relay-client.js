// 1-z-2 SDK — one file, zero dependencies, runs in browsers AND Node (22+).
//
// License: you may use this file and embed it, unmodified, in your own
// application (that is the intended distribution: vendor it as a local file).
// You may not modify it or republish it as a separate work. The canonical
// copy is always GET /sdk.js on your relay. The relay server is closed.
//
// A generated app vendors it from its relay and imports it locally:
//   curl -fsSL https://YOUR-RELAY/sdk.js -o relay-client.js
//   import { RelayClient } from "./relay-client.js";
//   const relay = await RelayClient.connect({ handle: "ana", relayUrl: "https://YOUR-RELAY" });
//   await relay.publish({ name: "recipe", direction: "send",
//     description: "a cooking recipe with ingredients and steps",
//     example: { title: "Pancakes", ingredients: ["2 cups flour"], steps: ["Mix", "Fry"] } });
//   const result = await relay.send("jane", "recipe", payload);
//   if (result.delivery === "compiling")   // first exchange between two shapes
//     relay.waitSent(result.id).then(showOutcome);  // background — can take
//       minutes; show progress on the sent item, never block the UI on it
//   relay.onReceive((msg) => { /* msg.payload is already in YOUR shape — but
//     it is msg.from_handle's data: show it in its own section, and only mix
//     it into the user's own data when the user explicitly imports it */ });
//
// Identity: an asymmetric keypair generated on the user's device and stored
// locally (localStorage in browsers, a JSON file in Node). The app is
// disposable; the identity is not — regenerate the app, keep the handle.
//
// Integrity: at matching versions this file is byte-identical to the npm
// package `1-z-2` (the operator's mirror on a registry neither party
// controls). To verify a vendored copy:
//   npm pack 1-z-2@<version> && tar -xOf 1-z-2-<version>.tgz package/client.js | diff - relay-client.js

// Vendored copies pin whatever version they downloaded, so the version rides
// in the file: the client sends it on every call, the relay answers with its
// current one, and a stale copy says so (once, in the console) rather than
// drifting silently.
export const SDK_VERSION = "1.6.0";

export class RelayClient {
  constructor({ handle, relayUrl, token, publicKeyPem }) {
    this.handle = handle;
    this.relayUrl = relayUrl.replace(/\/$/, "");
    this.token = token;
    this.publicKeyPem = publicKeyPem;
    this._polling = false;
  }

  /**
   * Register the handle on first run, or reuse locally stored credentials.
   * `invite` is required while the relay is invite-only (D2); it is used once,
   * at registration, and never stored.
   */
  static async connect({ handle, relayUrl = "http://localhost:8484", invite, fallbackId, credentialsFile } = {}) {
    if (!handle) throw new Error("handle required");
    const store = await makeStore(handle, credentialsFile);
    const saved = await store.load();
    if (saved?.token) {
      const client = new RelayClient({ handle, relayUrl, token: saved.token, publicKeyPem: saved.publicKeyPem });
      client._store = store;
      client.appId = saved.appId;
      // Sign with this app's device key: the paired-app device key if present,
      // otherwise the account key (the first app's device key is the account key).
      client._signingJwk = saved.devicePrivateJwk ?? saved.privateJwk;
      // Apps paired before enforcement existed converge here, one boot each.
      if (saved.signingEnforced !== true) await client._enableSigningEnforcement();
      return client;
    }
    const identity = await generateIdentity();
    const res = await fetch(relayUrl.replace(/\/$/, "") + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `fallbackId` is the claim path (the growth loop): the unguessable link
      // to a web-fallback page authorises registering the ONE handle that
      // message was addressed to, in place of an invite code the recipient has
      // no way to obtain.
      body: JSON.stringify({ handle, publicKey: identity.publicKeyPem, invite, fallbackId }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error(`handle "@${handle}" is taken and no local credentials were found for it — RelayClient.recover() re-issues a token from the stored keypair`);
      }
      if (res.status === 403) {
        throw new Error(`register refused: ${data.error}`);
      }
      throw new Error(`register failed: ${data.error}`);
    }
    await store.save({ token: data.token, appId: data.appId, publicKeyPem: identity.publicKeyPem, alg: identity.alg, privateJwk: identity.privateJwk });
    const client = new RelayClient({ handle, relayUrl, token: data.token, publicKeyPem: identity.publicKeyPem });
    client._store = store;
    client.appId = data.appId;
    client._signingJwk = identity.privateJwk; // first app: device key == account key
    await client._enableSigningEnforcement();
    return client;
  }

  /**
   * Recover a handle whose token is gone (or stolen) by proving possession of
   * the keypair generated at registration: sign a server nonce, receive a
   * fresh token. The old token stops working. Needs the saved identity —
   * localStorage in the origin that registered, or the `.relay-<handle>.json`
   * credentials file.
   */
  static async recover({ handle, relayUrl = "http://localhost:8484", credentialsFile } = {}) {
    if (!handle) throw new Error("handle required");
    const store = await makeStore(handle, credentialsFile);
    const saved = await store.load();
    if (!saved?.privateJwk) {
      throw new Error(`no stored identity key for "@${handle}" — recovery needs the keypair saved at registration`);
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("WebCrypto unavailable — cannot sign the recovery challenge");
    const base = relayUrl.replace(/\/$/, "");
    const post = async (path, body) => {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`recover failed: ${data.error || `HTTP ${res.status}`}`);
      return data;
    };
    const { nonce } = await post("/recover/challenge", { handle });
    const isEc = saved.privateJwk.kty === "EC";
    const key = await subtle.importKey(
      "jwk", saved.privateJwk,
      isEc ? { name: "ECDSA", namedCurve: saved.privateJwk.crv || "P-256" } : { name: "Ed25519" },
      false, ["sign"]
    );
    const signature = base64(await subtle.sign(
      isEc ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" },
      key, new TextEncoder().encode(nonce)
    ));
    const { token, appId } = await post("/recover", { handle, nonce, signature });
    await store.save({ ...saved, token, appId });
    const client = new RelayClient({ handle, relayUrl, token, publicKeyPem: saved.publicKeyPem });
    client._store = store;
    client.appId = appId;
    client._signingJwk = saved.devicePrivateJwk ?? saved.privateJwk;
    await client._enableSigningEnforcement();
    return client;
  }

  /**
   * Pair a NEW app onto a handle you already own (D25). One handle is one
   * person; each app is a device with its own key and token, but they share the
   * same identity — so a second app (a new browser origin, a server half) needs
   * to *join*, not register (that would collide on the taken handle).
   *
   * Account-key self-service: this proves possession of the account key — the
   * `privateJwk` saved in an existing app's credentials — by signing a server
   * nonce, then registers a fresh device key and receives this app's own token.
   * `accountCredentialsFile` is where the account key is read from (an existing
   * app's file); `credentialsFile` is where THIS app's new credentials are
   * written. In a browser both default to per-origin localStorage, so pass the
   * account key in explicitly to authorise the operation. It is never copied
   * into the new app's destination credentials.
   */
  static async pairApp({ handle, relayUrl = "http://localhost:8484", accountCredentialsFile, credentialsFile, label } = {}) {
    if (!handle) throw new Error("handle required");
    const accountStore = await makeStore(handle, accountCredentialsFile);
    const account = await accountStore.load();
    if (!account?.privateJwk) {
      throw new Error(`no account key for "@${handle}" — pairing needs the credentials from an app already on this handle`);
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("WebCrypto unavailable — cannot sign the pairing challenge");
    const base = relayUrl.replace(/\/$/, "");
    const post = async (path, body) => {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`pair failed: ${data.error || `HTTP ${res.status}`}`);
      return data;
    };
    const { nonce } = await post("/apps/pair/challenge", { handle });
    const isEc = account.privateJwk.kty === "EC";
    const key = await subtle.importKey(
      "jwk", account.privateJwk,
      isEc ? { name: "ECDSA", namedCurve: account.privateJwk.crv || "P-256" } : { name: "Ed25519" },
      false, ["sign"]
    );
    const signature = base64(await subtle.sign(
      isEc ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" },
      key, new TextEncoder().encode(nonce)
    ));
    // This app's OWN device key — the substrate request signing is built on.
    const device = await generateIdentity();
    const { appId, token } = await post("/apps/pair", { handle, devicePublicKey: device.publicKeyPem, label, nonce, signature });
    const destStore = await makeStore(handle, credentialsFile);
    const destination = await destStore.load();
    // Least privilege: the account recovery/pairing private key was needed to
    // authorise this operation, but it does not belong in every paired app.
    // This app receives only the public account identity plus its own device
    // key and token. Recovery or further pairing must be initiated from the
    // account-key holder explicitly.
    //
    // "Do not copy it in" is not "delete the one already here". The two stores
    // are frequently the SAME store — in Node whenever `credentialsFile` is
    // omitted or equals the account file, and in a browser always, since
    // localStorage is keyed by handle alone. A bare overwrite there would
    // destroy the only copy of the account key, and with it recovery and any
    // future pairing, irreversibly.
    await destStore.save({
      ...(destination?.privateJwk ? { privateJwk: destination.privateJwk } : {}),
      token, appId,
      publicKeyPem: account.publicKeyPem, alg: account.alg,
      deviceKeyPem: device.publicKeyPem, deviceAlg: device.alg, devicePrivateJwk: device.privateJwk,
    });
    const client = new RelayClient({ handle, relayUrl, token, publicKeyPem: account.publicKeyPem });
    client._store = destStore;
    client.appId = appId;
    client._signingJwk = device.privateJwk; // this app signs with its own device key
    await client._enableSigningEnforcement();
    return client;
  }

  /** This handle's apps (label, requireSigning, which one is current). */
  apps() {
    return this._call("GET", "/apps");
  }

  /**
   * The stored credentials for this handle — key material included. This is
   * what makes an identity portable: browser storage is per-origin, so without
   * exporting this file an app on another domain (or a rebuilt app, or a new
   * device) could never prove it is the same handle. Write it somewhere safe;
   * it is the identity, and there is no password reset behind it.
   */
  async exportCredentials() {
    const saved = await this._store?.load();
    if (!saved) throw new Error("no stored credentials for this handle in this context");
    return { handle: this.handle, relayUrl: this.relayUrl, ...saved };
  }

  /**
   * The other half of exportCredentials(): install an identity exported
   * elsewhere (or the file downloaded when the handle was claimed on the web)
   * into THIS context's store, so the next connect() reuses the handle instead
   * of trying to register it afresh and colliding (409). `credentials` is the
   * parsed JSON of the exported file; pass `handle` explicitly if the file
   * predates the handle riding inside it.
   */
  static async importCredentials({ handle, credentials, credentialsFile } = {}) {
    const h = handle || credentials?.handle;
    if (!h) throw new Error("handle required — pass it, or credentials that carry one");
    if (!credentials?.token || (!credentials.privateJwk && !credentials.devicePrivateJwk)) {
      throw new Error("credentials must be an exported identity (token + key material)");
    }
    // `handle`/`relayUrl` are export envelope, not stored credential fields.
    const { handle: _h, relayUrl: _r, ...saved } = credentials;
    const store = await makeStore(h, credentialsFile);
    await store.save(saved);
    return { handle: h, imported: true };
  }

  /**
   * Rotate this app's device (signing) key. The rotation request is itself
   * signed with the CURRENT key (proof of possession), then the new key is
   * persisted and used for every request after. Distinct from a token rotation.
   * Note: rotating the FIRST app's key moves it off the account key, so a later
   * recovery mints a fresh app rather than resetting this one.
   */
  async rotateDeviceKey() {
    if (!this._signingJwk) throw new Error("no signing key held — cannot rotate what cannot be proven");
    const device = await generateIdentity();
    await this._call("POST", "/apps/rotate-key", { devicePublicKey: device.publicKeyPem });
    const saved = (await this._store?.load?.()) || {};
    await this._store?.save?.({ ...saved, deviceKeyPem: device.publicKeyPem, deviceAlg: device.alg, devicePrivateJwk: device.privateJwk });
    this._signingJwk = device.privateJwk;
    this._signingKey = null; // force re-import on next sign
    return { rotated: true };
  }

  /**
   * Turn signing enforcement on (or off) for this app. Once on, the relay
   * refuses any unsigned request for this app — a stolen bearer token alone
   * stops being enough to act as it. Enabling is only allowed over a signed
   * request, which this is (the SDK signs automatically when it holds a key),
   * so you cannot lock yourself out of an app that cannot sign.
   */
  requireSigning(enable = true) {
    return this._call("POST", "/apps/signing", { require: enable });
  }

  /**
   * Lock this app to signed requests, best-effort. Runs after every flow that
   * leaves the client holding a device key, so a stolen bearer token alone
   * cannot act as the app. Failure is a deliberate no-op: an environment
   * without WebCrypto cannot sign, enforcing there would brick the app, and
   * the relay refuses to enable enforcement over an unsigned request for
   * exactly that reason — such apps stay on bearer-token auth.
   */
  async _enableSigningEnforcement() {
    try {
      await this.requireSigning(true);
      const saved = (await this._store?.load?.()) || {};
      await this._store?.save?.({ ...saved, signingEnforced: true });
    } catch (err) {
      console.warn(`[relay] could not enable signing enforcement: ${err?.message ?? err}`);
    }
  }

  /**
   * Bind a recovery email (D11) — the path back in if the keypair itself is
   * ever lost (a lost laptop with no exported credentials). Two steps: this
   * sends a code to the address, verifyEmail(code) completes the binding.
   * Nothing binds until the code round-trips, so a typo can't become the key
   * to the identity.
   */
  bindEmail(email) {
    return this._call("POST", "/account/email", { email });
  }

  /** Complete the binding started by bindEmail with the mailed code. */
  verifyEmail(code) {
    return this._call("POST", "/account/email/verify", { code });
  }

  /** Remove the recovery email. The removed address is notified. */
  unbindEmail() {
    return this._call("POST", "/account/email/delete");
  }

  /**
   * The handle's plan and usage: current tier, subscription status, and where
   * today's activity stands against each ceiling. Free is the default and
   * never expires; the relay never holds card details.
   */
  billing() {
    return this._call("GET", "/billing");
  }

  /**
   * Start a paid plan ("plus" or "pro"). Answers { url } — a Stripe-hosted
   * checkout page to send the person to. The plan turns on when Stripe
   * confirms payment (moments later), not when this call returns.
   */
  billingCheckout(plan) {
    return this._call("POST", "/billing/checkout", { plan });
  }

  /**
   * Manage an existing subscription — change card, download invoices,
   * cancel. Answers { url } for Stripe's own portal page.
   */
  billingPortal() {
    return this._call("POST", "/billing/portal");
  }

  /**
   * Delete the account: contacts, shapes, translations, this handle's inbox
   * and every app's access, gone for good. Messages already delivered to
   * other people stay with them, like email. The handle is retired, not
   * freed — nobody can register it again, including you. The request must be
   * signed (the SDK signs when it holds this app's device key) and echoes the
   * handle, so a stolen bearer token can never do this. Clears the local
   * credentials on success.
   */
  async deleteAccount() {
    const out = await this._call("POST", "/account/delete", { confirm: this.handle });
    try { await this._store?.save?.({}); } catch { /* local cleanup is best-effort */ }
    this.token = null;
    this._signingJwk = null;
    this._signingKey = null;
    return out;
  }

  /**
   * Ask the relay to mail a recovery code for a handle whose credentials are
   * gone. The response is deliberately the same whether or not the handle has
   * an email bound — the code (or nothing) arrives in the inbox. Follow with
   * RelayClient.recoverByEmail() once the code is in hand.
   */
  static async requestEmailRecovery({ handle, relayUrl = "http://localhost:8484" } = {}) {
    if (!handle) throw new Error("handle required");
    const res = await fetch(relayUrl.replace(/\/$/, "") + "/recover/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`email recovery request failed: ${data.error || `HTTP ${res.status}`}`);
    return data;
  }

  /**
   * Trade a mailed recovery code for a fresh identity. This is the full reset
   * RelayClient.recover() cannot do: a NEW account keypair is generated here
   * and replaces the lost one, every app's token is revoked (the lost device
   * held them all), and this context becomes the handle's primary app. The
   * handle, contacts, capabilities and contracts all survive — it is the
   * credentials that are reborn, not the identity.
   */
  static async recoverByEmail({ handle, code, relayUrl = "http://localhost:8484", credentialsFile } = {}) {
    if (!handle) throw new Error("handle required");
    if (!code) throw new Error("code required — request one with RelayClient.requestEmailRecovery()");
    const base = relayUrl.replace(/\/$/, "");
    const identity = await generateIdentity();
    const res = await fetch(base + "/recover/email/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, code, publicKey: identity.publicKeyPem }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`email recovery failed: ${data.error || `HTTP ${res.status}`}`);
    // Overwrite rather than merge: whatever this store held belonged to the
    // keypair that was just replaced, and keeping it would leave dead
    // credentials shadowing live ones.
    const store = await makeStore(handle, credentialsFile);
    await store.save({ token: data.token, appId: data.appId, publicKeyPem: identity.publicKeyPem, alg: identity.alg, privateJwk: identity.privateJwk });
    const client = new RelayClient({ handle, relayUrl, token: data.token, publicKeyPem: identity.publicKeyPem });
    client._store = store;
    client.appId = data.appId;
    client._signingJwk = identity.privateJwk; // primary app: device key == account key
    await client._enableSigningEnforcement();
    return client;
  }

  async _call(method, path, body) {
    const bodyStr = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
      "x-relay-sdk-version": SDK_VERSION,
    };
    // Sign every request when a device key is held (D25): the bearer token says
    // which app, the signature proves possession of its key. Best-effort — if
    // signing is unavailable the request goes unsigned, which the relay accepts
    // unless the app has enabled enforcement.
    const sig = await this._sign(method, path, bodyStr ?? "");
    if (sig) {
      headers["x-relay-timestamp"] = sig.ts;
      headers["x-relay-nonce"] = sig.nonce;
      headers["x-relay-signature"] = sig.signature;
    }
    const res = await fetch(this.relayUrl + path, { method, headers, body: bodyStr });
    const latest = res.headers?.get?.("x-relay-sdk-latest");
    if (latest && latest !== SDK_VERSION && !this._staleWarned) {
      this._staleWarned = true;
      console.warn(`[relay] this vendored SDK is v${SDK_VERSION} but the relay serves v${latest} — refresh it: curl -fsSL ${this.relayUrl}/sdk.js -o relay-client.js`);
    }
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Sign a request over the canonical string the relay reconstructs:
   * method, path (with query), timestamp, nonce, sha256(body). Returns the
   * three header values, or null when no key is held or WebCrypto is missing.
   */
  async _sign(method, path, bodyStr) {
    if (!this._signingJwk) return null;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    try {
      if (!this._signingKey) {
        const jwk = this._signingJwk;
        this._signingIsEc = jwk.kty === "EC";
        this._signingKey = await subtle.importKey(
          "jwk", jwk,
          this._signingIsEc ? { name: "ECDSA", namedCurve: jwk.crv || "P-256" } : { name: "Ed25519" },
          false, ["sign"]
        );
      }
      const enc = new TextEncoder();
      const ts = String(Date.now());
      const nonce = base64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      const bodyHash = hex(await subtle.digest("SHA-256", enc.encode(bodyStr)));
      const canonical = [method, path, ts, nonce, bodyHash].join("\n");
      const signature = base64(await subtle.sign(
        this._signingIsEc ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" },
        this._signingKey, enc.encode(canonical)
      ));
      return { ts, nonce, signature };
    } catch {
      return null; // signing is best-effort; unsigned still works unless enforced
    }
  }

  /**
   * Declare something this app can send or receive. `schema` is optional —
   * pass `example` (or `examples: [...]`) and the relay infers it. Call again
   * whenever the app is regenerated; the relay recompiles translations in the
   * background.
   */
  publish({ name, direction, description, schema, example, examples, announce }) {
    return this._call("POST", "/capabilities", { name, direction, description, schema, example, examples, announce });
  }

  /**
   * Show or hide one of this app's send capabilities in contacts' updates
   * feeds. Hidden still works — contacts can receive it — it just isn't news.
   */
  setAnnounce(name, announce) {
    return this._call("POST", "/capabilities/announce", { name, announce });
  }

  /**
   * The updates feed: what this handle's contacts can now send, newest first.
   * Each entry: { from, app, name, description, kind: "added"|"changed", at,
   * yours: "ready"|"missing"|"unknown", landsAs }. `yours: "missing"` means
   * nothing in this handle's apps receives it yet — pair it with
   * featurePrompt(update) to offer "would you like to add this?".
   */
  updates() {
    return this._call("GET", "/updates");
  }

  /**
   * The instruction a user pastes to their AI tool to add a contact's feature
   * to THIS app. Text only — copying it is the app's job. Deliberately says
   * "in whatever way fits this app": the point is a matching idea in this
   * app's own style, never a copy of the contact's data format.
   */
  featurePrompt(update) {
    const what = update.description ? `"${update.name}" — ${update.description}` : `"${update.name}"`;
    return (
      `My friend @${update.from}'s app on 1-z-2 can send ${what}. ` +
      `Add a feature to this app that receives those, in whatever way fits this app. ` +
      `Keep this app's own style and data format — don't copy theirs; 1-z-2 adapts between app formats automatically. ` +
      `Fetch ${this.relayUrl}/integrate.md and follow its steps for publishing a "receive" capability and showing received items. ` +
      `Use the handle "${this.handle}" with the credentials this app already has.`
    );
  }

  /**
   * Conversation pillar: plain text notes between contacts, the same in every
   * app ({ text, sentAt }), so no translation is ever needed. Publishes the
   * "chat" pair, unannounced (a standard part, not news). Capability names are
   * unique across a handle's apps, so if another of the user's apps already
   * carries chat this resolves { enabled: false } — conversation lives there;
   * hide this app's chat UI rather than failing.
   */
  async enableChat() {
    const example = { text: "See you at 7?", sentAt: "2026-01-15T18:30:00.000Z" };
    const description = "a short plain-text note from one person to another, like a chat message";
    try {
      for (const direction of ["receive", "send"]) {
        await this.publish({ name: "chat", direction, description, example, announce: false });
      }
      return { enabled: true };
    } catch (err) {
      if (err?.status === 409) return { enabled: false, reason: err.message };
      throw err;
    }
  }

  /** Send a plain-text note to a contact. Requires enableChat() to have run. */
  sendChat(to, text, options) {
    return this.send(to, "chat", { text: String(text), sentAt: new Date().toISOString() }, options);
  }

  /** Remove a published capability from your directory entry and routing. */
  unpublish(name, direction) {
    return this._call("POST", "/capabilities/delete", { name, direction });
  }

  /** Resolves { to, status: "pending" | "already-accepted" }. */
  /**
   * Opt-in introductions: who this user could be introduced to, through
   * which mutual friend, and what those people's apps can send. `open` is
   * this user's own switch; `suggestions` is empty while it is off.
   *   → { open, suggestions: [{ handle, via: [handles], sends: [{ name, description }] }] }
   */
  introductions() {
    return this._call("GET", "/introductions");
  }

  /** Turn introductions on or off for this handle (off by default). */
  setIntroductions(open) {
    return this._call("POST", "/introductions", { open: Boolean(open) });
  }

  /**
   * Ask to connect. `via` (optional) names the mutual friend an introduction
   * came through — take it from introductions(); the relay refuses any other.
   */
  requestContact(to, message, { via } = {}) {
    return this._call("POST", "/contacts/request", { to, message, ...(via ? { via } : {}) });
  }

  pendingRequests() {
    return this._call("GET", "/contacts/requests");
  }

  acceptContact(from) {
    return this._call("POST", "/contacts/accept", { from });
  }

  /** Full roster: { contacts, incoming, outgoing, blocked } — no local copy needed. */
  contacts() {
    return this._call("GET", "/contacts");
  }

  /**
   * The message log, both directions, newest first: metadata + provenance,
   * never bodies (drill into a received message with messageOriginal(id) while
   * retention holds it). { messages, nextBefore } — pass nextBefore back as
   * `before` to page further into history.
   */
  messages({ limit, before } = {}) {
    const q = new URLSearchParams();
    if (limit) q.set("limit", String(limit));
    if (before) q.set("before", String(before));
    const qs = q.toString();
    return this._call("GET", `/messages${qs ? `?${qs}` : ""}`);
  }

  /**
   * The routing table + transform inspector: every contract this handle is a
   * party to, each with the compiled transform serving it (code, the
   * compiler's declared dropped/assumed/notes, which model wrote it) —
   * "show me exactly what the relay did to my data."
   */
  contracts() {
    return this._call("GET", "/contracts");
  }

  /** This handle's own capabilities, full detail (schema, examples, owning app). */
  capabilities() {
    return this._call("GET", "/capabilities");
  }

  /**
   * What the relay is holding for this handle right now, and when it stops
   * holding it: `policy` (the TTLs and the last sweep), `words` (message bodies
   * the relay can still read, with the moment the last of them is purged),
   * `shapes` (messages whose words are already gone), `publicPages`, and
   * `durable` (identity, contacts, capabilities — no expiry by design).
   */
  retention() {
    return this._call("GET", "/retention");
  }

  /**
   * Correct a translation delivered TO you (only the recipient can). Either
   * describe the fix in plain language — `correction`, durable and re-applied
   * on every recompile, so it survives the sender regenerating their app — or
   * supply the transform `code` directly (validated over the whole corpus, but
   * a raw patch dies at the next schema version bump). `clear: true` removes
   * the correction. `from` is the sender's handle, `type` their capability name.
   */
  correctTranslation({ from, type, correction, code, clear } = {}) {
    return this._call("POST", "/contracts/correct", { from, type, correction, code, clear });
  }

  /** Silently decline a pending request (the requester is not notified). */
  declineContact(from) {
    return this._call("POST", "/contacts/decline", { from });
  }

  /** Refuse all mail from a handle and withdraw your own consent toward them. */
  blockContact(handle) {
    return this._call("POST", "/contacts/block", { handle });
  }

  /** Back to strangers — they may send a fresh contact request. */
  unblockContact(handle) {
    return this._call("POST", "/contacts/unblock", { handle });
  }

  /** Disconnect amicably: both directions of consent erased, either side may re-request. */
  removeContact(handle) {
    return this._call("POST", "/contacts/remove", { handle });
  }

  /**
   * Swap the bearer token for a fresh one (the old one dies immediately) and
   * persist it to the local credential store, so the next connect() still
   * works. For a token you can't present anymore, use RelayClient.recover().
   */
  async rotateToken() {
    const { token } = await this._call("POST", "/token/rotate");
    this.token = token;
    if (this._store) {
      const saved = (await this._store.load()) || {};
      await this._store.save({ ...saved, token });
    }
    return token;
  }

  async lookup(handle) {
    const res = await fetch(`${this.relayUrl}/directory/${handle}`);
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Send a payload (in YOUR app's shape; the relay translates).
   * Resolves to { delivery: "queued" | "compiling" | "web-fallback", ... }.
   * "compiling" happens at most once per shape pair — poll waitSent(id).
   */
  /**
   * Send a payload to a handle. `idempotencyKey` (optional, ≤128 chars, unique
   * per message you compose) makes a retry safe: if the relay already handled
   * that key it reports the original outcome instead of delivering twice —
   * which is what you want when a send times out and you cannot tell whether
   * it landed. Reuse the SAME key when retrying the SAME message; a fresh
   * message needs a fresh key.
   */
  send(to, type, payload, { idempotencyKey } = {}) {
    return this._call("POST", "/send", { to, type, payload, idempotencyKey });
  }

  /**
   * Status of a message you sent:
   *   { status: compiling|queued|delivered|failed|expired, error? }
   * `expired` is the dead letter: it was never collected within the retention
   * window and will not be — the one terminal state that means nobody read it.
   * A queued/delivered status WITH an error means graceful failure: the relay
   * could not compile a translation, so it delivered your exact bytes with the
   * failure declared to the recipient rather than failing the message.
   */
  sentStatus(id) {
    return this._call("GET", `/sent/${id}`);
  }

  /**
   * Poll until a parked message finishes compiling (or fails). A first
   * exchange between two shapes can take minutes, so run this in the
   * background and reflect the outcome on the sent item — never hold the UI
   * on this promise. Throws only on timeout; a failed message RESOLVES with
   * status "failed".
   */
  async waitSent(id, { intervalMs = 1500, timeoutMs = 180000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.sentStatus(id);
      if (msg.status !== "compiling") return msg;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("timed out waiting for message to compile");
  }

  /**
   * Queued messages. Each carries a `provenance` block (D9):
   *
   *   { translated, sentAs, match?, dropped?, assumed?, original?,
   *     failure?, note?, page? }
   *
   * `translated: true` means the payload you are holding is NOT the bytes the
   * sender sent — the relay rewrote it into your shape. `sentAs` is their name
   * for it. `dropped` is what their payload had and yours does not; `assumed`
   * is what yours has that they never said (a placeholder, a default, a
   * currency the transform had to pick). Both are the compiler's own
   * admissions, so an empty list is a claim of fidelity, not an absence of
   * information.
   *
   * Render them. A translated message shown with no indication it was
   * translated is precisely the silent mistranslation the relay promises not
   * to commit — the relay can only make the fact available; only your app can
   * put it in front of a person.
   *
   * `failure` means graceful failure: translation could not be compiled, so
   * the payload is the sender's exact bytes in THEIR shape, not yours. Your
   * schema makes no promise about it — render it generically (or link `page`,
   * a relay-hosted human-readable view that always works) rather than
   * dropping it on the floor, and show `note`/`failure` so the person knows
   * why it looks foreign.
   */
  async inbox() {
    const { messages } = await this._call("GET", "/inbox");
    return messages;
  }

  /**
   * One batch of queued messages plus whether more are waiting behind it:
   * { messages, more }. `inbox()` returns just the batch; use this when you
   * want to drain a backlog deliberately (ack each batch, then fetch again
   * while `more` is true).
   */
  inboxBatch({ limit } = {}) {
    return this._call("GET", `/inbox${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`);
  }

  /**
   * The evidence behind a message's provenance: what the sender actually sent,
   * beside what you actually received.
   *
   *   { from, sentAs, original, receivedAs, received, provenance, sentAt }
   *
   * Wire this to a "show me what they sent" affordance on any message whose
   * `provenance.translated` is true. Throws 410 once the body has passed the
   * retention TTL — provenance is words, and the relay keeps shapes, not
   * words.
   */
  messageOriginal(id) {
    return this._call("GET", `/messages/${encodeURIComponent(id)}/original`);
  }

  ack(ids) {
    return this._call("POST", "/inbox/ack", { ids });
  }

  /**
   * Prove the whole integration loop against the relay's built-in echo
   * (@relay-echo): connectivity, credentials, publish, contact flow, send,
   * receive, provenance — no second person and no compiler involved. Prints a
   * per-step checklist and resolves { ok, steps } (it never throws; a failed
   * step is a report, not an exception).
   *
   * Run it once, at a point where this app's onReceive loop is NOT yet
   * consuming the inbox (right after connect during development, or as a
   * standalone script) — the test polls the inbox itself and acks only its
   * own echo reply. Publishes a scratch "selftest-ping" capability for the
   * round-trip and unpublishes it on the way out.
   */
  async selfTest({ timeoutMs = 15000 } = {}) {
    const steps = [];
    const run = async (step, fn) => {
      try {
        const detail = await fn();
        steps.push({ step, ok: true, ...(detail ? { detail } : {}) });
        return true;
      } catch (err) {
        steps.push({ step, ok: false, detail: String(err?.message || err) });
        return false;
      }
    };

    await run("relay reachable", async () => {
      const res = await fetch(this.relayUrl + "/health");
      if (!res.ok) throw new Error(`GET /health answered ${res.status}`);
      return this.relayUrl;
    });
    const authed = await run("credentials accepted", async () => {
      const { capabilities } = await this._call("GET", "/capabilities");
      const own = capabilities.filter((c) => c.name !== "selftest-ping");
      return own.length
        ? `@${this.handle} — ${own.length} capabilit${own.length === 1 ? "y" : "ies"} published`
        : `@${this.handle} — no capabilities published yet (this app should publish on every start)`;
    });
    if (!authed) return finish(this.handle, steps);

    const ping = { ping: `selftest-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const published = await run("publish", async () => {
      await this.publish({ name: "selftest-ping", direction: "send",
        description: "self-test ping used to verify this integration end-to-end", example: ping });
      await this.publish({ name: "selftest-ping", direction: "receive",
        description: "self-test ping used to verify this integration end-to-end", example: ping });
    });
    if (published) {
      await run("contact flow", async () => {
        const { status } = await this.requestContact("relay-echo", "self-test");
        if (status !== "already-accepted") throw new Error(`expected already-accepted, got "${status}"`);
        return "@relay-echo consents automatically";
      });
      const sent = await run("send", async () => {
        const r = await this.send("relay-echo", "selftest-ping", ping);
        if (r.delivery !== "queued") throw new Error(`expected delivery "queued", got "${r.delivery}"`);
        return `message ${r.id} echoed`;
      });
      if (sent) {
        await run("receive + provenance", async () => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            // Direct inbox read, not onReceive: only the echo reply may be
            // acked — anything else queued belongs to the app and must stay.
            const { messages } = await this._call("GET", "/inbox?wait=5");
            const reply = messages.find(
              (m) => m.from_handle === "relay-echo" && m.payload?.ping === ping.ping
            );
            if (reply) {
              if (!reply.provenance) throw new Error("echo reply arrived without a provenance block");
              await this.ack([reply.id]);
              return `round-trip ok, provenance present (translated: ${reply.provenance.translated})`;
            }
          }
          throw new Error(
            `no echo reply within ${timeoutMs}ms — is another receive loop consuming this inbox? ` +
            "Run selfTest before wiring onReceive, with no other copy of the app open."
          );
        });
      }
      await run("cleanup", async () => {
        await this.unpublish("selftest-ping", "send");
        await this.unpublish("selftest-ping", "receive");
      });
    }
    return finish(this.handle, steps);

    function finish(handle, steps) {
      const ok = steps.every((s) => s.ok);
      console.log(`[relay] self-test for @${handle}: ${ok ? "PASS" : "FAIL"}`);
      for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.step}${s.detail ? ` — ${s.detail}` : ""}`);
      if (!ok) console.log("[relay] fix the failing step and run selfTest() again until it passes.");
      return { ok, steps };
    }
  }

  /**
   * Handler for the relay-originated event delivered when a contact request
   * this handle sent is accepted: handler({ event, handle }). Refresh your
   * contacts UI in it. Events ride the same inbox loop as messages, so
   * onReceive() must be running for them to arrive.
   */
  onContactAccepted(handler) {
    this._contactAccepted = handler;
  }

  /**
   * Everything a UI needs to render one received message's provenance,
   * pre-decided — so the app renders fields instead of re-implementing the
   * show/don't-show rules. Returns one of:
   *
   *   { kind: "plain" }
   *     — the payload is what the sender sent; show nothing (a badge on
   *       every message is a badge nobody reads).
   *   { kind: "translated", badge, dropped, assumed, fetchOriginal }
   *     — the relay rewrote the sender's data into this app's shape. Show
   *       `badge` quietly; if `dropped`/`assumed` are non-empty show them
   *       verbatim (they are the compiler's own admissions). Wire "see what
   *       they sent" to fetchOriginal() → { original, ... }.
   *   { kind: "untranslated", note, failure, page }
   *     — graceful failure: the payload is the sender's exact bytes in THEIR
   *       shape. Do not insert it like local data; render it generically
   *       (raw JSON is fine) with `note`, and link `page` — a relay-hosted
   *       view that renders it readably.
   */
  provenanceSummary(msg) {
    const p = msg?.provenance || {};
    if (p.failure) {
      return {
        kind: "untranslated",
        note: p.note || "delivered exactly as sent — the relay could not translate this message",
        failure: p.failure,
        page: p.page ? this.relayUrl + p.page : null,
      };
    }
    if (!p.translated) return { kind: "plain" };
    return {
      kind: "translated",
      badge: `translated from "${p.sentAs}"`,
      dropped: p.dropped || [],
      assumed: p.assumed || [],
      fetchOriginal: () => this.messageOriginal(msg.id),
    };
  }

  /**
   * Own the roster-refresh discipline of the contacts screen: fetch the
   * roster now, re-fetch when someone accepts this app's request (the relay
   * pushes that event through the onReceive loop — keep it running), and keep
   * a slow fallback poll in case the event was missed. `onRoster` receives
   * the full { contacts, incoming, outgoing, blocked } every time.
   *
   * Returns { refresh, stop }. Call refresh() after any accept / decline /
   * request action and whenever the contacts screen is shown. This registers
   * the client's onContactAccepted handler — put any extra accept-time
   * behavior in `onRoster` rather than replacing it.
   */
  syncContacts(onRoster, { pollMs = 60000 } = {}) {
    let stopped = false;
    const refresh = async () => {
      if (stopped) return;
      try {
        onRoster(await this.contacts());
      } catch (err) {
        // The roster screen going stale must never take the app down.
        console.error("[relay] roster refresh failed:", err?.message || err);
      }
    };
    this.onContactAccepted(refresh);
    const timer = setInterval(refresh, pollMs);
    timer.unref?.();
    refresh();
    return { refresh, stop: () => { stopped = true; clearInterval(timer); } };
  }

  /** Process one batch of messages: handler per message, acked on success. */
  async _handleBatch(messages, handler, report) {
    let handlerFailed = false;
    for (const msg of messages) {
      // Relay system events (type "relay:*") never reach the app's message
      // handler — apps insert received messages as data, and these aren't
      // data. Acked even when the event handler fails or is absent: a
      // missed refresh is recovered by the next roster fetch, a redelivery
      // loop is not.
      if (typeof msg.type === "string" && msg.type.startsWith("relay:")) {
        try {
          if (msg.type === "relay:contact-accepted" && this._contactAccepted) {
            await this._contactAccepted(msg.payload);
          }
        } catch (err) {
          report(err, msg);
        }
        await this.ack([msg.id]).catch((err) => report(err, msg));
        continue;
      }
      try {
        await handler(msg);
        await this.ack([msg.id]);
      } catch (err) {
        report(err, msg);
        handlerFailed = true;
      }
    }
    return handlerFailed;
  }

  /** Read and process everything currently queued, batch by batch. */
  async _drain(handler, report) {
    let more = true;
    while (this._polling && more) {
      const res = await this._call("GET", "/inbox");
      more = Boolean(res.more);
      if (res.messages.length === 0) return;
      if (await this._handleBatch(res.messages, handler, report)) {
        await new Promise((r) => setTimeout(r, 2000)); // a failing handler must not hot-loop
        return;
      }
    }
  }

  /**
   * Receive messages: handler per message, acked on success. Returns a stop
   * function. A handler that throws is reported (console by default, or your
   * `onError`), the message stays unacked and redelivers — at-least-once, with
   * a pause so a persistent handler bug cannot hot-loop.
   *
   * Transport is push (SSE) with long-poll as the fallback, and the choice is
   * invisible to your handler. The stream carries a nudge, never the mail, so
   * every message still arrives through the same inbox read either way. Pass
   * `push: false` to force long-polling.
   *
   * Placement: msg.payload arrives already translated into this app's own
   * shape, but it is another person's data. Give received items their own
   * clearly separated area labeled with msg.from_handle, and keep them out of
   * the user's own totals and stats — merging into the user's data is an
   * explicit per-item user action ("add to my data"), never the default.
   */
  onReceive(handler, { onError, push = true } = {}) {
    this._polling = true;
    const report = onError ||
      ((err, msg) => console.error(`[relay] ${msg ? `handler failed for message ${msg.id}` : "inbox poll failed"}:`, err?.message || err));
    (async () => {
      let usePush = push && typeof fetch === "function";
      while (this._polling) {
        if (usePush) {
          try {
            const streamed = await this._streamEvents(handler, report);
            // The stream ended cleanly (relay restart, proxy timeout): reconnect.
            // If it never streamed at all, this runtime can't do it — stop trying.
            if (!streamed) usePush = false;
            else continue;
          } catch (err) {
            report(err, null);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        }
        // Long-poll fallback. `more` means come straight back rather than
        // waiting 25s while a backlog trickles out one batch per poll.
        let messages, more;
        try {
          ({ messages, more } = await this._call("GET", "/inbox?wait=25"));
        } catch (err) {
          report(err, null);
          await new Promise((r) => setTimeout(r, 2000)); // relay unreachable; back off
          continue;
        }
        if (await this._handleBatch(messages, handler, report)) {
          await new Promise((r) => setTimeout(r, 2000));
        } else if (more) {
          await this._drain(handler, report);
        }
      }
    })();
    return () => { this._polling = false; this._stopStream?.(); };
  }

  /**
   * Hold open the SSE stream, draining the inbox on every nudge. Resolves true
   * when a stream that WAS established has ended (so the caller reconnects),
   * false when this runtime cannot stream at all (so the caller falls back for
   * good). Uses `fetch` rather than `EventSource` because auth is a bearer
   * header — EventSource cannot send headers, and the alternative is a token in
   * the URL, where it would land in logs and referrers.
   */
  async _streamEvents(handler, report) {
    const controller = new AbortController();
    this._stopStream = () => controller.abort();
    let res;
    try {
      const headers = { authorization: `Bearer ${this.token}`, accept: "text/event-stream", "x-relay-sdk-version": SDK_VERSION };
      // Signed like every other request (D25) — an app locked to signed
      // requests is refused here otherwise, and push silently never starts.
      const sig = await this._sign("GET", "/events", "");
      if (sig) {
        headers["x-relay-timestamp"] = sig.ts;
        headers["x-relay-nonce"] = sig.nonce;
        headers["x-relay-signature"] = sig.signature;
      }
      res = await fetch(this.relayUrl + "/events", { headers, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) return true;
      throw err;
    }
    // 404 (an older relay) or 429 (too many streams) are both "not via push".
    if (!res.ok || !res.body?.getReader) return false;

    const reader = res.body.getReader();
    const decode = new TextDecoder();
    let buffer = "";
    try {
      while (this._polling) {
        const { value, done } = await reader.read();
        if (done) return true;
        buffer += decode.decode(value, { stream: true });
        // Frames are separated by a blank line. Comments (": ping") carry no
        // event and are skipped by this check naturally.
        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (/^event: (mail|ready)$/m.test(frame)) {
            await this._drain(handler, report);
          }
        }
      }
      return true;
    } catch (err) {
      if (controller.signal.aborted) return true;
      report(err, null);
      return true; // treat a broken stream as reconnectable
    } finally {
      // cancel() returns a promise that rejects after an abort — swallow both
      // forms, or stopping the stream is an unhandled rejection in Node.
      try { reader.cancel().catch(() => {}); } catch { /* already closed */ }
      this._stopStream = null;
    }
  }
}

// ---- identity (WebCrypto: works in browsers and Node) ----------------------
async function generateIdentity() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto unavailable — cannot generate identity keys");
  const attempts = [
    { name: "Ed25519" },
    { name: "ECDSA", namedCurve: "P-256" }, // fallback for browsers without Ed25519
  ];
  let lastErr;
  for (const alg of attempts) {
    try {
      const kp = await subtle.generateKey(alg, true, ["sign", "verify"]);
      const spki = await subtle.exportKey("spki", kp.publicKey);
      const privateJwk = await subtle.exportKey("jwk", kp.privateKey);
      return { alg: alg.name, publicKeyPem: toPem(spki), privateJwk };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function toPem(spkiBuffer) {
  const b64 = base64(spkiBuffer);
  const lines = b64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function base64(buf) {
  if (typeof Buffer !== "undefined") return Buffer.from(buf).toString("base64");
  let s = "";
  for (const c of new Uint8Array(buf)) s += String.fromCharCode(c);
  return btoa(s);
}

function hex(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, "0");
  return s;
}

// ---- credential storage (localStorage in browsers, JSON file in Node) ------
async function makeStore(handle, credentialsFile) {
  if (typeof localStorage !== "undefined") {
    const key = `relay:${handle}`;
    return {
      load: () => JSON.parse(localStorage.getItem(key) || "null"),
      save: (v) => localStorage.setItem(key, JSON.stringify(v)),
    };
  }
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const file = credentialsFile || `.relay-${handle}.json`;
  return {
    load: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null),
    save: (v) => writeFileSync(file, JSON.stringify(v, null, 2)),
  };
}
