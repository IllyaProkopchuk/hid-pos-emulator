import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildScanReports, toHex, type Fault } from '../src/shared/framing.js';
import { DEVICE_PROFILES } from '../src/shared/profiles.js';

const NEWLAND = DEVICE_PROFILES.newland;
const GENERIC = DEVICE_PROFILES.generic;
const UNKNOWN_VENDOR = DEVICE_PROFILES.unknownVendorLengthByte;

const CR = 0x0d;
const LF = 0x0a;
const ETX = 0x03;

const faults = (...items: Array<Fault>): Set<Fault> => new Set(items);

const decodeReport = (report: Uint8Array, hasLengthByte: boolean): string => {
  const content = hasLengthByte ? report.subarray(1, 1 + (report[0] ?? 0)) : report;

  return new TextDecoder().decode(content).replace(/\0+$/, '');
};

test('single report holds a payload shorter than the chunk size', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, { terminator: 'CR' });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.length, NEWLAND.reportSize);
  assert.equal(reports[0]?.[0], 13);
  assert.equal(
    decodeReport(reports[0] as Uint8Array, true),
    `221-3351-753${String.fromCharCode(CR)}`,
  );
});

test('a payload of exactly 56 bytes fills one report and sets the length byte to 0x38', () => {
  const text = 'A'.repeat(55);
  const reports = buildScanReports(text, NEWLAND, { terminator: 'CR' });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.[0], 0x38);
  assert.equal(reports[0]?.[56], CR);
});

test('a payload of 57 bytes is split into two reports and the second carries the remainder length', () => {
  const text = 'B'.repeat(56);
  const reports = buildScanReports(text, NEWLAND, { terminator: 'CR' });

  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.[0], 0x38);
  assert.equal(reports[1]?.[0], 1);
  assert.equal(reports[1]?.[1], CR);
});

test('every Newland report is zero padded to the profile report size', () => {
  const reports = buildScanReports('L9NV277X', NEWLAND, { terminator: 'CR' });
  const report = reports[0] as Uint8Array;

  assert.equal(report.length, NEWLAND.reportSize);
  assert.deepEqual(Array.from(report.subarray(10)), new Array(NEWLAND.reportSize - 10).fill(0));
});

test('the generic profile sends 64 byte reports without a length byte', () => {
  const text = 'C'.repeat(70);
  const reports = buildScanReports(text, GENERIC, { terminator: 'LF' });

  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.length, GENERIC.reportSize);
  assert.equal(reports[0]?.[0], 'C'.charCodeAt(0));
  assert.equal(decodeReport(reports[0] as Uint8Array, false), 'C'.repeat(64));
  assert.equal(
    decodeReport(reports[1] as Uint8Array, false),
    `${'C'.repeat(6)}${String.fromCharCode(LF)}`,
  );
});

test('the AIM prefix and the terminator are part of the payload bytes', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, {
    aimPrefix: ']Q3',
    terminator: 'ETX',
  });
  const report = reports[0] as Uint8Array;

  assert.equal(toHex(report.subarray(0, 4)), '10 5d 51 33');
  assert.equal(report[report[0] as number], ETX);
});

test('terminator "none" produces no CR, LF or ETX byte', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, { terminator: 'none' });
  const bytes = Array.from(reports[0] as Uint8Array);

  assert.equal(reports[0]?.[0], 12);
  assert.ok(![CR, LF, ETX].some((byte) => bytes.includes(byte)));
});

test('fault missingLengthByte drops the length byte and starts the payload at byte 0', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, {
    terminator: 'CR',
    faults: faults('missingLengthByte'),
  });
  const report = reports[0] as Uint8Array;

  assert.equal(report.length, NEWLAND.reportSize);
  assert.equal(report[0], '2'.charCodeAt(0));
  assert.equal(decodeReport(report, false), `221-3351-753${String.fromCharCode(CR)}`);
});

test('fault noTerminator leaves the payload unterminated', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, {
    terminator: 'CR',
    faults: faults('noTerminator'),
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.[0], 12);
  assert.ok(!Array.from(reports[0] as Uint8Array).includes(CR));
});

test('fault terminatorInOwnReport sends the terminator as a separate report', () => {
  const reports = buildScanReports('221-3351-753', NEWLAND, {
    terminator: 'CR',
    faults: faults('terminatorInOwnReport'),
  });

  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.[0], 12);
  assert.ok(!Array.from(reports[0] as Uint8Array).includes(CR));
  assert.equal(toHex(reports[1] as Uint8Array).startsWith('01 0d 00'), true);
  assert.equal(reports[1]?.length, NEWLAND.reportSize);
});

test('toHex renders space separated lowercase bytes', () => {
  assert.equal(toHex(Uint8Array.of(0x38, 0x5d, 0x51, 0x33)), '38 5d 51 33');
});

test('the unknown vendor profile frames like Newland in 63 byte reports', () => {
  const text = 'https://tickets.example.com/emulator-qr/ticket/505-1786-106?pin=39321';
  const reports = buildScanReports(text, UNKNOWN_VENDOR, { terminator: 'CR' });

  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.length, UNKNOWN_VENDOR.reportSize);
  assert.equal(reports[0]?.[0], 0x38);
  assert.equal(reports[1]?.[0], text.length + 1 - UNKNOWN_VENDOR.maxPayloadBytes);
  assert.equal(reports[1]?.length, UNKNOWN_VENDOR.reportSize);
});
