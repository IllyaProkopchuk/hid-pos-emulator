import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReportDescriptor, toDescriptorHex } from '../src/shared/descriptor.js';
import { DEVICE_PROFILES, getReportDescriptorOptions, toServiceProfile } from '../src/shared/profiles.js';

/**
 * The bytes are pinned, not recomputed from the builder: hidclass derives the collections from
 * them and apps key a device on those collections, so a change here is a change an app reading the
 * scanner can see.
 *
 * The third byte pair is usage 0x03 on purpose. Usage 0x02 is the one compatible id Windows' own
 * `hidscanner.inf` claims, and that driver fails to start on this descriptor, which leaves the
 * collection in Code 10 with no HID interface at all. See `descriptor.ts`.
 */
const WITH_REPORT_IDS_HEX =
  '058c0903a101850209fe150026ff007508953f810285030600ff090195409102850409029502b102c0';

const WITHOUT_REPORT_IDS_HEX =
  '058c0903a10109fe150026ff007508954081020600ff09019540910209029502b102c0';

test('the report id descriptor is 41 bytes and declares input 63, output 64, feature 2', () => {
  const descriptor = buildReportDescriptor({ withReportIds: true, inputLength: 63 });
  const fromProfile = buildReportDescriptor(getReportDescriptorOptions(DEVICE_PROFILES.newland));

  assert.equal(descriptor.length, 41);
  assert.equal(toDescriptorHex(descriptor), WITH_REPORT_IDS_HEX);
  assert.equal(toDescriptorHex(fromProfile), WITH_REPORT_IDS_HEX);
  assert.equal(toServiceProfile(DEVICE_PROFILES.newland).reportDescriptorHex, WITH_REPORT_IDS_HEX);
});

test('the id-less descriptor drops every Report ID item and carries a 64 byte input report', () => {
  const descriptor = buildReportDescriptor({ withReportIds: false, inputLength: 64 });

  assert.equal(descriptor.length, 35);
  assert.equal(toDescriptorHex(descriptor), WITHOUT_REPORT_IDS_HEX);
  assert.equal(
    toServiceProfile(DEVICE_PROFILES.generic).reportDescriptorHex,
    WITHOUT_REPORT_IDS_HEX,
  );
});
