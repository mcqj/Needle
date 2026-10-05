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
```

Playwright may require its Chromium test browser on a new machine:

```sh
npx playwright install chromium
```

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
e2e/              Playwright browser tests
```

All relay plumbing lives in `src/features/friends/relay-client.js` (connect,
publish, receive, contacts, chat, updates) and `relayStore.js` (mapping relay
events onto the app's own state). UI code never calls the SDK directly, and a
relay that cannot be reached leaves the ledger fully usable.

## Artwork Behavior

YouTube watch, short, embed, and `youtu.be` URLs automatically resolve to a YouTube thumbnail. Other sources can use a manually supplied image URL or an uploaded image. Uploaded images are stored with the entry in browser storage, so the app limits each file to 2 MB.
