# Needle

Needle is a personal listening ledger for saving music URLs and the details worth remembering. Entries can be categorized, rated, reviewed, searched, sorted, edited, and revisited from a responsive interface.

## Features

- Save links from YouTube, Spotify, Bandcamp, SoundCloud, and other music sources.
- Organize entries with free-form categories.
- Add a five-point rating and an optional review.
- Add artwork using an image URL or an image file up to 2 MB.
- Automatically use the video thumbnail for supported YouTube URLs.
- Search across titles, artists, categories, and reviews.
- Sort by date, rating, or artist.
- Switch between light and dark modes with a saved device preference.
- Edit or delete saved entries.
- Use the full workflow on desktop and mobile layouts.

## Technology

- React 19 with JavaScript
- Vite
- React Router
- Material UI
- Jotai with `atomWithStorage`
- Vitest and React Testing Library
- Playwright
- ESLint

The app has no backend. Music entries and interface filters are stored in the browser using Jotai storage atoms. Data does not currently synchronize between browsers or devices.

## Getting Started

Install dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

Vite will print the local URL to open in a browser.

## Commands

```sh
npm run dev            # Start the development server
npm run build          # Create a production build
npm run preview        # Preview the production build
npm run lint           # Run ESLint
npm test               # Run unit tests once
npm run test:watch     # Run unit tests in watch mode
npm run test:coverage  # Run unit tests with V8 coverage
npm run test:ui        # Run Playwright browser tests
npm run relay:selftest # Prove the 1-z-2 loop end to end against the relay
npm run assets:dev     # Run the Worker locally (real R2 bucket + built app)
npm run assets:test    # Test the Worker
npm run assets:deploy  # Deploy the app and its asset API together
npm run test:all       # App tests and Worker tests
```

Playwright may require its Chromium test browser on a new machine:

```sh
npx playwright install chromium
```

## How it is deployed

The app and its artwork host are **one Cloudflare Worker**:

```
https://needle.jmq33.workers.dev
```

`needle/` contains the Worker; the built frontend in `dist/` is uploaded with it
as static assets. Static asset requests are free and unlimited, and only requests
that reach the script are billable — the script handles exactly three paths
(`/upload`, `/i/<key>`, `/health`), declared in `run_worker_first` in
`needle/wrangler.toml`. Everything else, including every page of the app, is
served as an asset without invoking the script.

Deploying:

```sh
npm run build
npm run assets:deploy      # wrangler deploy, from needle/
```

Client-side routing is handled by `not_found_handling = "single-page-application"`,
so `/friends` and `/music/:id` — which exist only in the browser — survive a
refresh rather than 404ing. No `_redirects` file is involved; Workers parses that
format more strictly than Pages and rejects it, and the setting does the job.

### Why one Worker rather than Pages plus a Worker

An earlier version ran the app on Pages and the images on a separate Worker. Two
origins meant cross-origin uploads, a `CORS` allow-list to keep in step with every
deployment hostname, absolute image URLs pinned to one host, and preview
deployments that could not upload until they were added to the list.

As one origin, all of that disappears: stored image URLs are relative
(`/i/<key>`), there is no CORS involved, and a same-origin upload is trusted by
construction rather than by configuration.

### Artwork storage

Uploaded images do not live in the browser. They go to the R2 bucket
`needle-assets` and the entry keeps only the returned URL. That is what keeps
browser storage small, lets the same picture appear on every device, and stops a
cleared browser from taking the artwork with it.

Entries are unchanged: `imageUrl` still holds a URL, so the 1-z-2 capability and
everything built on it behave exactly as before.

Objects are content-addressed by the SHA-256 of their bytes: the same bytes always
produce the same key, so re-uploading is idempotent and a key's URL never changes.
That is what makes the one-year immutable cache safe.

Development uses a **real bucket, locally**:

```sh
npm run assets:dev   # the Worker, backed by needle/.wrangler/r2 on disk
npm run dev          # the app; Vite proxies /api/* and /i/* to it
```

`npm run build && npm run assets:dev` then serving <http://127.0.0.1:8787> also
exercises the Worker's own routing — uploads, image serving and the SPA fallback —
the way production behaves.

If the asset host is unreachable, the app embeds a small image in the entry
instead of failing: like the relay, the asset host must never break the ledger.
Set `VITE_ASSET_ENDPOINT` (see `.env.example`) to an absolute URL if the asset API
is ever served elsewhere, or to `off` to opt out of uploads entirely.

### Uploads are not open to the internet

Uploading is a write, so `/upload` refuses a request it does not recognise. A
same-origin request is allowed by construction: it came from the page this Worker
served, and a page cannot forge `Origin`, so a cross-site script cannot produce a
matching one. Configured origins cover development, where Vite serves the app on
another port; and `UPLOAD_TOKEN` (set with `wrangler secret put UPLOAD_TOKEN`,
sent as `X-Upload-Token`) covers callers with no `Origin` at all.

CORS alone would not have been enough: it restrains browsers, so a script with
`curl` ignores it entirely. An early version of this endpoint accepted an upload
with a forged `Origin` for exactly that reason.

### First visit to a new origin

Browser credentials live in `localStorage`, which is scoped to an origin, so a
newly deployed site starts with no relay identity. The friends screen offers
**Import identity file**; choose the `.relay-jmq.json` in this project. Until then
1-z-2 reports the handle as taken, because the app has no key for this origin to
prove it is `@jmq`. That is the point of a device key — an identity belongs to a
place.

## Exchanging music with other apps

Needle speaks to [1-z-2](https://relay.1-z-2.com), a relay that lets
independently built apps exchange useful items. Each app keeps its own natural
shape; the relay translates between them. Needle publishes one concept —
`saved-listen`, the whole entry as this app already stores it — in both
directions, so a listen can be sent to a friend's app and one can arrive from
it.

Everything lives behind **Listening circle** in the top bar:

- **Sharing with** — the contact roster, incoming requests, and the
  introductions switch. The roster is kept on the relay, never copied locally.
- **Shared with me** — listens friends sent, kept in their own area. They never
  count toward your saved listens, categories, or sort order until you press
  *Add to my ledger*, and the copy keeps a `from @handle` note.
- **Conversation** — plain notes between contacts, stored on this device only.
- **Updates** — what your contacts' apps have added lately. Adding one copies a
  request to your clipboard; nothing is added on its own.

Sending is per item: every row in the ledger and every detail page has a
*Send* action. Sending never blocks the interface — the first exchange between
two differently shaped apps takes about a minute to compile, so progress shows
on the item itself with an explanation of why it is slow.

### Identity

The handle's credentials live in `.relay-jmq.json` in the project directory,
which is gitignored and never bundled. On first run in development, the app
reads them from a dev-only `/.relay-identity` endpoint (see `vite.config.js`)
and imports them into the browser's own credential store. After that, the key
is reused silently and the endpoint is not needed. A production build has no
such endpoint; the friends screen offers an *Import identity file* input
instead, so no key material ever has to be pasted anywhere.

### Checking the integration

`npm run relay:selftest` runs the relay's own end-to-end check against
`@relay-echo`: connectivity, credentials, publish, the contact flow, send,
receive and provenance. It is a standalone script, not part of the app.

### What leaves this device

Nothing is sent automatically. Data leaves Needle only when you send a
specific listen to a specific person, and only people who have accepted a
contact request can receive anything. The relay reads message payloads —
translation between differently shaped apps requires the plaintext — and says
so itself, in machine-readable form, on the contacts screen.

## Project Structure

```text
src/
  app/            Application shell, router, and Material UI theme
  components/     Shared interface components
  features/
    library/      Ledger list, entry dialog, and rows
    detail/       A single listen
    friends/      The listening circle and all 1-z-2 plumbing
  state/          Persisted Jotai atoms
  tests/          Shared test setup
  utils/          URL, artwork, file, and formatting helpers
relay-client.js   Vendored 1-z-2 SDK, unmodified
scripts/          Standalone integration checks
needle/           The deployed Worker: app routing, upload API, image serving
e2e/              Playwright browser tests
```

All relay plumbing lives in `src/features/friends/relay-client.js` (connect,
publish, receive, contacts, chat, updates) and `relayStore.js` (mapping relay
events onto the app's own state). UI code never calls the SDK directly, and a
relay that cannot be reached leaves the ledger fully usable.

## Artwork Behavior

YouTube watch, short, embed, and `youtu.be` URLs automatically resolve to a YouTube thumbnail. Other sources can use a manually supplied image URL or an uploaded image, which is stored by the asset host (see above) and referenced by URL. If the artwork link later stops returning an image, the entry says so plainly instead of showing a broken image.
