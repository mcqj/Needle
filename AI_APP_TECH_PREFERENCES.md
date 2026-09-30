# AI App Technology Preferences

This document describes the default technology choices to use when standing up a new application for this workspace. Treat these as the starting point for new app scaffolding unless the user explicitly overrides them.

## Version Policy

- Use the latest stable released version of each selected dependency at the time the app is created.
- Do not pin to stale examples from older tutorials.
- Prefer official installation instructions and current package metadata over memory.
- As of 2026-09-30, React is expected to be on the React 19 line, currently `19.3.x`.
- Prefer `npm install` command over editing package.json.
- Use normal semver ranges in `package.json` unless a package or tool requires exact pinning for compatibility.

## Core Stack

- React for the UI.
- JavaScript, not TypeScript.
- Vite as the build tool and development server.
- React Router for client-side routing.
- Material UI for the component system.
- Jotai for local and shared client state.
- TanStack Query when the app needs to interact with a backend or any remote async data source.
- Vitest for unit and component tests.
- Playwright for browser-based UI interaction tests.

## Explicit Non-Goals

- Do not use TypeScript unless explicitly requested.
- Do not scaffold with server-side React frameworks such as Next.js.
- Do not introduce server-side rendering, React Server Components, or framework routing unless explicitly requested.
- Do not manage `sessionStorage` or `localStorage` directly when Jotai storage atoms fit the need.

## Recommended Scaffold

Use the React JavaScript Vite template:

```sh
npm create vite@latest <app-name> -- --template react
```

Then install current stable releases for the chosen stack:

```sh
npm install react@latest react-dom@latest react-router@latest @mui/material@latest @emotion/react@latest @emotion/styled@latest jotai@latest
npm install @tanstack/react-query@latest
npm install -D vitest@latest @vitest/coverage-v8@latest playwright@latest @testing-library/react@latest @testing-library/user-event@latest jsdom@latest
```

Only install `@tanstack/react-query` when the application has backend or remote-data needs. For purely local tools, leave it out until it is needed.

## Routing Preferences

- Use React Router in client-side/browser routing mode.
- Keep routes colocated with feature areas where that makes the app easier to navigate.
- Avoid framework mode, SSR mode, file-system route generation, or server loaders unless explicitly requested.
- Prefer clear route names and predictable URL structures over clever abstractions.

## State Management Preferences

- Use Jotai for global client state that is genuinely shared across components.
- Keep state local to a component when it does not need to be shared.
- Use derived atoms for computed state when that keeps components simpler.
- For persisted browser state, use Jotai storage utilities rather than manual storage calls.
- For session-scoped state, use `atomWithStorage` with a `sessionStorage`-backed storage adapter, rather than directly reading or writing `sessionStorage`.

Example pattern:

```js
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const sessionStorageAdapter = createJSONStorage(() => sessionStorage);

export const selectedAlbumIdAtom = atomWithStorage(
  'selected-album-id',
  null,
  sessionStorageAdapter,
);
```

## Backend And Data Fetching Preferences

Use TanStack Query for server state when the app reads from or writes to a backend.

- Use TanStack Query for fetching, caching, invalidation, refetching, mutations, and request lifecycle state.
- Do not duplicate remote data into Jotai unless there is a specific UI-state reason.
- Keep Jotai for client-only state, preferences, selections, filters, drafts, and UI state.
- Keep API client functions small and framework-agnostic.
- Centralize query keys so invalidation stays predictable as the app grows.

## Material UI Preferences

- Use Material UI components as the default UI building blocks.
- Prefer MUI theme customization over one-off styling.
- Use MUI layout primitives and components before introducing additional UI libraries.
- Keep styling in JavaScript or standard CSS modules when needed; do not add a competing styling framework without a clear reason.
- Use accessible MUI components and preserve keyboard interaction by default.

## Testing Preferences

- Use Vitest for unit tests and component tests.
    - Use V8 for coverage.
- Use React Testing Library for component behavior tests.
- Use Playwright for real browser interaction tests and key user workflows.
- Keep tests focused on behavior rather than implementation details.
- Add tests for routing, state persistence, backend-query behavior, and important user interactions when those areas are touched.

Suggested scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "playwright test"
  }
}
```

## Project Structure Preferences

Start simple and grow only when the app needs it:

```text
src/
  app/
    App.jsx
    router.jsx
    theme.js
  components/
  features/
  state/
  api/
  utils/
  tests/
```

Guidelines:

- Put shared app wiring under `src/app`.
- Put reusable visual components under `src/components`.
- Put domain-specific workflows under `src/features`.
- Put Jotai atoms under `src/state` or inside the feature that owns them.
- Put backend client functions and query helpers under `src/api`.
- Put framework-agnostic utilities shared by components and other code under `src/utils`.
- Avoid premature abstraction. Start with the clearest structure for the current app.

## Quality Defaults

- Ensure the app runs with `npm run dev`.
- Ensure production builds pass with `npm run build`.
- Ensure unit tests pass with `npm test`.
- Ensure Playwright tests cover the most important user flows once UI workflows exist.
- Prefer small, composable components.
- Prefer explicit data flow over hidden side effects.
- Keep generated apps easy for another AI agent or human developer to understand quickly.

## Decision Rules For Future AI Agents

When creating a new app:

1. Start with React, JavaScript, and Vite.
2. Add React Router for navigation.
3. Add Material UI for the UI layer.
4. Add Jotai when state must be shared beyond a single component.
5. Use `atomWithStorage` for persisted or session-scoped Jotai state.
6. Add TanStack Query only when remote data or backend interaction exists.
7. Add Vitest for unit/component testing.
8. Add Playwright for browser workflow testing.
9. Use the latest stable released versions available at scaffold time.
10. Ask before choosing a server-side framework, TypeScript, or a substantially different stack.
