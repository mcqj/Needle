import { atom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const localStorageAdapter = createJSONStorage(() => localStorage);
const sessionStorageAdapter = createJSONStorage(() => sessionStorage);
const preferredColorMode = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light';

export const colorModeAtom = atomWithStorage(
  'needle-color-mode',
  preferredColorMode,
  localStorageAdapter,
  { getOnInit: true },
);

export const libraryAtom = atomWithStorage(
  'needle-library',
  [],
  localStorageAdapter,
  { getOnInit: true },
);

export const searchAtom = atomWithStorage(
  'needle-search',
  '',
  sessionStorageAdapter,
  { getOnInit: true },
);

export const categoryFilterAtom = atomWithStorage(
  'needle-category',
  'All music',
  sessionStorageAdapter,
  { getOnInit: true },
);

export const sortAtom = atomWithStorage(
  'needle-sort',
  'newest',
  sessionStorageAdapter,
  { getOnInit: true },
);

export const categoriesAtom = atom((get) => {
  const categories = get(libraryAtom)
    .map((track) => track.category?.trim())
    .filter(Boolean);
  return ['All music', ...new Set(categories)];
});
