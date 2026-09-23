import type { DeviceProfile } from './profiles.js';

export type Fault = 'missingLengthByte' | 'noTerminator' | 'terminatorInOwnReport';

export type AimPrefix = string | null;

export type TerminatorName = 'CR' | 'LF' | 'ETX' | 'none';

export type FramingOptions = {
  aimPrefix?: AimPrefix;
  terminator?: TerminatorName;
  faults?: ReadonlySet<Fault>;
};

const TERMINATOR_BYTES: Record<TerminatorName, number | null> = {
  CR: 0x0d,
  LF: 0x0a,
  ETX: 0x03,
  none: null,
};

const NO_FAULTS: ReadonlySet<Fault> = new Set<Fault>();

const getTerminatorByte = (
  terminator: TerminatorName,
  faults: ReadonlySet<Fault>,
): number | null => {
  if (faults.has('noTerminator')) {
    return null;
  }

  return TERMINATOR_BYTES[terminator];
};

const chunkPayload = (payload: Uint8Array, chunkSize: number): Array<Uint8Array> => {
  const chunks: Array<Uint8Array> = [];

  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    chunks.push(payload.subarray(offset, offset + chunkSize));
  }

  return chunks;
};

const buildReport = (
  chunk: Uint8Array,
  reportSize: number,
  withLengthByte: boolean,
): Uint8Array => {
  const report = new Uint8Array(reportSize);

  if (withLengthByte) {
    report[0] = chunk.length;
    report.set(chunk, 1);

    return report;
  }

  report.set(chunk, 0);

  return report;
};

/**
 * Builds the HID input reports a scanner would emit for one scan, in the order they arrive.
 * Each report is already padded to the profile's report size, so the app only has to turn the
 * bytes into an `inputreport` event.
 */
export const buildScanReports = (
  text: string,
  profile: DeviceProfile,
  options: FramingOptions = {},
): Array<Uint8Array> => {
  const { aimPrefix = null, terminator = 'CR', faults = NO_FAULTS } = options;
  const terminatorByte = getTerminatorByte(terminator, faults);
  const shouldSendTerminatorSeparately =
    terminatorByte !== null && faults.has('terminatorInOwnReport');
  const withLengthByte = profile.hasLengthByte && !faults.has('missingLengthByte');

  const inlineTerminator =
    terminatorByte !== null && !shouldSendTerminatorSeparately
      ? String.fromCharCode(terminatorByte)
      : '';
  const payload = new TextEncoder().encode(`${aimPrefix ?? ''}${text}${inlineTerminator}`);

  const reports = chunkPayload(payload, profile.maxPayloadBytes).map((chunk) =>
    buildReport(chunk, profile.reportSize, withLengthByte),
  );

  if (shouldSendTerminatorSeparately) {
    reports.push(buildReport(Uint8Array.of(terminatorByte), profile.reportSize, withLengthByte));
  }

  return reports;
};

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
