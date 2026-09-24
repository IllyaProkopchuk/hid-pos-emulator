import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addToHistory,
  HISTORY_LIMIT,
  STARRED_LIMIT,
  parseSavedCodes,
  renameStarred,
  toggleStarred,
} from '../src/ui/utils/codeHistory.js';

test('a repeated scan moves to the top instead of appearing twice', () => {
  let history = addToHistory([], { text: 'A', aimPrefix: '' }, 1);

  history = addToHistory(history, { text: 'B', aimPrefix: '' }, 2);
  history = addToHistory(history, { text: 'A', aimPrefix: '' }, 3);

  assert.deepEqual(
    history.map((entry) => [entry.text, entry.scannedAt]),
    [
      ['A', 3],
      ['B', 2],
    ],
  );
});

test('the same text with another AIM prefix is a different code', () => {
  let history = addToHistory([], { text: 'A', aimPrefix: '' }, 1);

  history = addToHistory(history, { text: 'A', aimPrefix: ']Q3' }, 2);

  assert.equal(history.length, 2);
});

test('the history keeps only the newest scans', () => {
  let history = addToHistory([], { text: '0', aimPrefix: '' }, 0);

  for (let index = 1; index <= HISTORY_LIMIT + 5; index++) {
    history = addToHistory(history, { text: String(index), aimPrefix: '' }, index);
  }

  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0]?.text, String(HISTORY_LIMIT + 5));
});

test('starring twice unstars, and a rename touches only its own code', () => {
  const qr = { text: 'Q', aimPrefix: ']Q3', format: 'qr_code' };
  let starred = toggleStarred([], qr);

  starred = toggleStarred(starred, { text: 'B', aimPrefix: '' });
  starred = renameStarred(starred, qr, '  expired ticket ');

  assert.deepEqual(starred, [
    { text: 'Q', aimPrefix: ']Q3', format: 'qr_code', label: 'expired ticket' },
    { text: 'B', aimPrefix: '', label: '' },
  ]);
  assert.equal(toggleStarred(starred, qr).length, 1);
});

test('no more codes can be starred than fit above the text box', () => {
  let starred = toggleStarred([], { text: '0', aimPrefix: '' });

  for (let index = 1; index <= STARRED_LIMIT; index++) {
    starred = toggleStarred(starred, { text: String(index), aimPrefix: '' });
  }

  assert.equal(starred.length, STARRED_LIMIT);
  // Unstarring still works on a full list.
  assert.equal(toggleStarred(starred, { text: '0', aimPrefix: '' }).length, STARRED_LIMIT - 1);
});

test('stored codes survive a round trip; malformed storage is dropped, not thrown', () => {
  const codes = {
    history: addToHistory([], { text: 'A', aimPrefix: ']C0' }, 5),
    starred: toggleStarred([], { text: 'B', aimPrefix: '' }),
  };

  assert.deepEqual(parseSavedCodes(JSON.stringify(codes)), codes);
  assert.deepEqual(parseSavedCodes(null), { history: [], starred: [] });
  assert.deepEqual(parseSavedCodes('not json'), { history: [], starred: [] });
  assert.deepEqual(
    parseSavedCodes(JSON.stringify({ history: [{ text: 1 }, null], starred: 'x' })),
    { history: [], starred: [] },
  );
});
