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
```

Playwright may require its Chromium test browser on a new machine:

```sh
npx playwright install chromium
```

## Project Structure

```text
src/
  app/         Application shell, router, and Material UI theme
  components/  Shared interface components
  features/    Library and music-detail workflows
  state/       Persisted Jotai atoms
  tests/       Shared test setup
  utils/       URL, artwork, file, and formatting helpers
e2e/           Playwright browser tests
```

## Artwork Behavior

YouTube watch, short, embed, and `youtu.be` URLs automatically resolve to a YouTube thumbnail. Other sources can use a manually supplied image URL or an uploaded image. Uploaded images are stored with the entry in browser storage, so the app limits each file to 2 MB.
