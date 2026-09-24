/**
 * Recent scans and starred codes, kept by the page so a code does not have to be typed again.
 * Pure functions over plain data; `useSavedCodes` owns the state and the browser storage.
 */

/** How many recent scans are kept. */
export const HISTORY_LIMIT = 20;

/** How many codes can be starred: they are pinned above the text box, so the row stays short. */
export const STARRED_LIMIT = 6;

/** What it takes to send a code again; terminator, pacing and faults come from the options. */
export type SavedCode = {
  text: string;
  /** Empty string means no AIM prefix. */
  aimPrefix: string;
  /** The symbology, when the code was decoded from a photo. */
  format?: string;
};

export type HistoryEntry = SavedCode & {
  /** Milliseconds since the epoch of the last time this code was sent. */
  scannedAt: number;
};

export type StarredCode = SavedCode & {
  /** A name the user gave the code, such as "expired ticket"; empty until they do. */
  label: string;
};

export type SavedCodes = {
  /** Newest first. */
  history: Array<HistoryEntry>;
  /** In the order they were starred. */
  starred: Array<StarredCode>;
};

export const EMPTY_SAVED_CODES: SavedCodes = { history: [], starred: [] };

/** Two entries are the same code when they would put the same bytes on the wire. */
export const isSameCode = (a: SavedCode, b: SavedCode): boolean =>
  a.text === b.text && a.aimPrefix === b.aimPrefix;

/** Put a sent code at the top of the history, dropping its earlier copy and the oldest overflow. */
export const addToHistory = (
  history: Array<HistoryEntry>,
  code: SavedCode,
  scannedAt: number,
): Array<HistoryEntry> => {
  const entry: HistoryEntry = { text: code.text, aimPrefix: code.aimPrefix, scannedAt };

  if (code.format !== undefined) {
    entry.format = code.format;
  }

  return [entry, ...history.filter((existing) => !isSameCode(existing, code))].slice(
    0,
    HISTORY_LIMIT,
  );
};

export const isStarred = (starred: Array<StarredCode>, code: SavedCode): boolean =>
  starred.some((existing) => isSameCode(existing, code));

/** A star can always be taken off, and put on only while there is room. */
export const canToggleStar = (starred: Array<StarredCode>, code: SavedCode): boolean =>
  starred.length < STARRED_LIMIT || isStarred(starred, code);

/** Star a code that is not starred yet, or unstar one that is. A full list stays as it is. */
export const toggleStarred = (starred: Array<StarredCode>, code: SavedCode): Array<StarredCode> => {
  if (isStarred(starred, code)) {
    return starred.filter((existing) => !isSameCode(existing, code));
  }

  if (starred.length >= STARRED_LIMIT) {
    return starred;
  }

  const entry: StarredCode = { text: code.text, aimPrefix: code.aimPrefix, label: '' };

  if (code.format !== undefined) {
    entry.format = code.format;
  }

  return [...starred, entry];
};

export const renameStarred = (
  starred: Array<StarredCode>,
  code: SavedCode,
  label: string,
): Array<StarredCode> =>
  starred.map((existing) =>
    isSameCode(existing, code) ? { ...existing, label: label.trim() } : existing,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toSavedCode = (value: unknown): SavedCode | null => {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.aimPrefix !== 'string') {
    return null;
  }

  const code: SavedCode = { text: value.text, aimPrefix: value.aimPrefix };

  if (typeof value.format === 'string') {
    code.format = value.format;
  }

  return code;
};

/**
 * Read what an earlier session stored. Anything malformed is dropped entry by entry rather than
 * failing the page: the storage belongs to the browser and can hold whatever an older build wrote.
 */
export const parseSavedCodes = (raw: string | null): SavedCodes => {
  if (raw === null) {
    return EMPTY_SAVED_CODES;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SAVED_CODES;
  }

  if (!isRecord(parsed)) {
    return EMPTY_SAVED_CODES;
  }

  const history: Array<HistoryEntry> = [];
  const starred: Array<StarredCode> = [];

  (Array.isArray(parsed.history) ? parsed.history : []).forEach((value: unknown) => {
    const code = toSavedCode(value);

    if (code && isRecord(value) && typeof value.scannedAt === 'number') {
      history.push({ ...code, scannedAt: value.scannedAt });
    }
  });

  (Array.isArray(parsed.starred) ? parsed.starred : []).forEach((value: unknown) => {
    const code = toSavedCode(value);

    if (code && !isStarred(starred, code) && starred.length < STARRED_LIMIT) {
      const label = isRecord(value) && typeof value.label === 'string' ? value.label : '';

      starred.push({ ...code, label });
    }
  });

  return { history: history.slice(0, HISTORY_LIMIT), starred };
};
