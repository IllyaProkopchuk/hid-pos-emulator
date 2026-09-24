import { useEffect, useState } from 'react';

import {
  addToHistory,
  EMPTY_SAVED_CODES,
  parseSavedCodes,
  renameStarred,
  toggleStarred,
  type SavedCode,
  type SavedCodes as SavedCodesData,
} from '@/utils/codeHistory';

/**
 * Where the codes live. Browser storage is per origin, so a host started on another port starts
 * with an empty list.
 */
const STORAGE_KEY = 'hidPosEmu.savedCodes.v1';

export type SavedCodes = SavedCodesData & {
  /** Record a code that was just sent. */
  recordScan: (code: SavedCode) => void;
  toggleStar: (code: SavedCode) => void;
  rename: (code: SavedCode, label: string) => void;
  clearHistory: () => void;
};

// Storage can be missing or refuse access (a private window, blocked site data); the page works
// without it and simply forgets on reload.
const load = (): SavedCodesData => {
  try {
    return parseSavedCodes(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_SAVED_CODES;
  }
};

const save = (codes: SavedCodesData) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // See `load`.
  }
};

/** Recent scans and starred codes, remembered by the browser between sessions. */
export const useSavedCodes = (): SavedCodes => {
  const [codes, setCodes] = useState<SavedCodesData>(load);

  useEffect(() => {
    save(codes);
  }, [codes]);

  // Another tab with the page open changed the list; the last write wins, so follow it.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setCodes(parseSavedCodes(event.newValue));
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return {
    ...codes,
    recordScan: (code) =>
      setCodes((current) => ({
        ...current,
        history: addToHistory(current.history, code, Date.now()),
      })),
    toggleStar: (code) =>
      setCodes((current) => ({ ...current, starred: toggleStarred(current.starred, code) })),
    rename: (code, label) =>
      setCodes((current) => ({ ...current, starred: renameStarred(current.starred, code, label) })),
    clearHistory: () => setCodes((current) => ({ ...current, history: [] })),
  };
};
