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
npm run assets:dev     # Run the artwork asset host locally (real R2 bucket)
npm run assets:test    # Test the asset host
npm run test:all       # App tests and asset-host tests
```

Playwright may require its Chromium test browser on a new machine:

```sh
npx playwright install chromium
```

## Artwork storage

Uploaded images do not live in the browser. They go to a small Cloudflare Worker
in `worker/` that stores them in an R2 bucket and returns a URL, and the entry
keeps only that URL. That is what keeps browser storage small, lets the same
picture appear on every device, and stops a cleared browser from taking the
artwork with it.

Entries are unchanged: `imageUrl` still holds a URL, so the 1-z-2 capability and
everything built on it behave exactly as before.

Development uses a **real bucket, locally**. Two terminals:

```sh
npm run assets:dev   # the Worker, backed by worker/.wrangler/r2 on disk
npm run dev          # the app; /api/assets is proxied to the Worker
```

Objects are content-addressed: the same bytes always produce the same key, so
re-uploading is idempotent and the URL for a given image never changes — which
is why it is served with a one-year immutable cache.

If the asset host is unreachable, the app embeds a small image in the entry
instead rather than failing. That is deliberate: like the relay, the asset host
must never break the ledger. Set `VITE_ASSET_ENDPOINT` (see `.env.example`) to
an absolute URL for a deployed build, or to `""` to opt out of uploads entirely.

### Deploying the asset host

Once you have a Cloudflare account:

```sh
cd worker
npx wrangler login          # interactive, once
npx wrangler r2 bucket create needle-assets
npx wrangler deploy
```

Deployed at `https://needle-assets.jmq33.workers.dev` on the free
`*.workers.dev` subdomain, which needs no domain registration:

```sh
npm run assets:login     # wrangler login (interactive, once)
npm run assets:bucket    # create the R2 bucket
npm run assets:deploy    # deploy; prints the Worker URL
```

Then keep two values in `worker/wrangler.toml` current and redeploy:

- `PUBLIC_BASE` — the Worker's absolute URL, so stored image URLs name a host.
  Relative URLs would resolve against the app's origin, which is a different
  origin entirely.
- `ALLOWED_ORIGINS` — every origin the app is served from, including the
  deployed one once the frontend is hosted. Uploads from anywhere else are
  refused.

When you later attach a custom domain, point `PUBLIC_BASE` at it; keys are
content-addressed, so every existing image URL keeps working.

R2's own `*.r2.dev` subdomain is rate-limited and documented as non-production,
which is why images are served by the Worker rather than by an R2 public URL.

### Uploads are not open to the internet

Uploading is a write, so `/upload` requires an allowed `Origin`. A browser
always sends `Origin` on a cross-origin request and cannot forge it, which shuts
out scripted abuse — CORS alone does not, because it only restrains browsers.

Note that `PUBLIC_BASE` and `ALLOWED_ORIGINS` are not secrets: they are visible
in any build. The origin rule is what keeps the endpoint honest. For a
server-side caller with no `Origin`, set a shared secret instead:

```sh
npx wrangler secret put UPLOAD_TOKEN
```

and send it as `X-Upload-Token`. When set, a correct token is accepted in place
of a matching origin.

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
worker/           Artwork asset host (Cloudflare Worker + R2)
e2e/              Playwright browser tests
```

All relay plumbing lives in `src/features/friends/relay-client.js` (connect,
publish, receive, contacts, chat, updates) and `relayStore.js` (mapping relay
events onto the app's own state). UI code never calls the SDK directly, and a
relay that cannot be reached leaves the ledger fully usable.

## Artwork Behavior

YouTube watch, short, embed, and `youtu.be` URLs automatically resolve to a YouTube thumbnail. Other sources can use a manually supplied image URL or an uploaded image, which is stored by the asset host (see above) and referenced by URL. If the artwork link later stops returning an image, the entry says so plainly instead of showing a broken image.
