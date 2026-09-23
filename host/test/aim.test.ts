import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAimPrefixForFormat, getAimPrefixes, isValidAimPrefix } from '../src/shared/aim.js';

test('every documented format maps to its AIM identifier', () => {
  const expected: Record<string, string> = {
    qr_code: ']Q3',
    code_128: ']C0',
    code_39: ']A0',
    code_93: ']G0',
    ean_13: ']E0',
    ean_8: ']E4',
    upc_e: ']E0',
    itf: ']I0',
    data_matrix: ']d2',
    pdf417: ']L2',
    aztec: ']z3',
  };

  Object.entries(expected).forEach(([format, prefix]) => {
    assert.equal(getAimPrefixForFormat(format), prefix);
  });
});

test('format lookup ignores case, so ZXing names work too', () => {
  assert.equal(getAimPrefixForFormat('QR_CODE'), ']Q3');
  assert.equal(getAimPrefixForFormat('Code_128'), ']C0');
});

test('an unknown format maps to no prefix', () => {
  assert.equal(getAimPrefixForFormat('codabar'), null);
  assert.equal(getAimPrefixForFormat(''), null);
});

test('a valid AIM prefix is a bracket, a letter and a digit', () => {
  assert.equal(isValidAimPrefix(']Q3'), true);
  assert.equal(isValidAimPrefix(']d2'), true);
  assert.equal(isValidAimPrefix(']z3'), true);
});

test('malformed AIM prefixes are rejected', () => {
  assert.equal(isValidAimPrefix('Q3'), false);
  assert.equal(isValidAimPrefix(']QQ'), false);
  assert.equal(isValidAimPrefix(']q33'), false);
  assert.equal(isValidAimPrefix(']'), false);
  assert.equal(isValidAimPrefix(''), false);
  assert.equal(isValidAimPrefix(' ]Q3'), false);
});

test('every mapped prefix passes its own validation', () => {
  Object.values(getAimPrefixes()).forEach((prefix) => {
    assert.equal(isValidAimPrefix(prefix), true);
  });
});

test('the exported map is a copy, so callers cannot mutate it', () => {
  const prefixes = getAimPrefixes();

  prefixes.qr_code = ']XX';

  assert.equal(getAimPrefixForFormat('qr_code'), ']Q3');
});
