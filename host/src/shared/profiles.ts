import {
  buildReportDescriptor,
  toDescriptorHex,
  type ReportDescriptorOptions,
} from './descriptor.js';

export type DeviceProfileId = 'newland' | 'generic' | 'unknownVendorLengthByte';

export type DeviceProfile = {
  id: DeviceProfileId;
  label: string;
  vendorId: number;
  productId: number;
  versionNumber: number;
  manufacturer: string;
  productName: string;
  serialNumber: string;
  /**
   * Bytes of one input report as the app receives it in `HIDInputReportEvent.data`, i.e. without
   * the HID report id, which the browser strips. Newland puts 64 bytes on the wire, of which the
   * first one is the report id.
   */
  reportSize: number;
  /** How many payload bytes one report can carry; the rest of the report is zero padding. */
  maxPayloadBytes: number;
  /**
   * Newland HID-POS puts the payload length into the first byte of the report; other vendors send
   * plain text, which is why an app that reads both has to branch on the vendor id.
   */
  hasLengthByte: boolean;
  reportId: number;
};

/**
 * The profile as the service needs it for `SwDeviceCreate`: the seven device properties the driver
 * reads in `EvtDeviceAdd`, nothing else.
 */
export type ServiceProfile = {
  instanceId: string;
  vendorId: number;
  productId: number;
  versionNumber: number;
  manufacturer: string;
  product: string;
  serialNumber: string;
  reportDescriptorHex: string;
};

const NEWLAND_PROFILE: DeviceProfile = {
  id: 'newland',
  label: 'Newland NLS-HR22 (HID-POS)',
  vendorId: 0x1eab,
  productId: 0x3910,
  versionNumber: 0x0100,
  manufacturer: 'Newland Auto-ID',
  productName: 'NLS-HR22',
  serialNumber: 'EMU-NEWLAND-0001',
  reportSize: 63,
  maxPayloadBytes: 56,
  hasLengthByte: true,
  reportId: 2,
};

const GENERIC_PROFILE: DeviceProfile = {
  id: 'generic',
  label: 'Generic HID-POS',
  vendorId: 0x05e0,
  productId: 0x1200,
  versionNumber: 0x0100,
  manufacturer: 'Generic',
  productName: 'Generic HID-POS',
  serialNumber: 'EMU-GENERIC-0001',
  reportSize: 64,
  maxPayloadBytes: 64,
  hasLengthByte: false,
  reportId: 0,
};

/**
 * Newland framing under a vendor id the app does not know: an app that branches on the vendor id
 * then takes its plain text branch and decodes the length byte as a character, so a 56 byte first
 * report turns `https://…` into `8https://…`.
 */
const UNKNOWN_VENDOR_LENGTH_BYTE_PROFILE: DeviceProfile = {
  id: 'unknownVendorLengthByte',
  label: 'HID-POS with length byte, unknown vendor',
  vendorId: 0x0c2e,
  productId: 0x0bfe,
  versionNumber: 0x0100,
  manufacturer: 'Unknown Vendor',
  productName: 'HID-POS (length byte, unknown vendor)',
  serialNumber: 'EMU-UNKNOWN-0001',
  reportSize: 63,
  maxPayloadBytes: 56,
  hasLengthByte: true,
  reportId: 2,
};

export const DEVICE_PROFILES: Record<DeviceProfileId, DeviceProfile> = {
  newland: NEWLAND_PROFILE,
  generic: GENERIC_PROFILE,
  unknownVendorLengthByte: UNKNOWN_VENDOR_LENGTH_BYTE_PROFILE,
};

export const DEFAULT_PROFILE_ID: DeviceProfileId = 'newland';

export const getDeviceProfile = (profileId: string): DeviceProfile => {
  const profile = DEVICE_PROFILES[profileId as DeviceProfileId];

  if (typeof profile === 'undefined') {
    throw new Error(`Unknown device profile: ${profileId}`);
  }

  return profile;
};

/** A profile carries report ids exactly when it declares one; `generic` sends id-less reports. */
export const withReportIds = (profile: DeviceProfile): boolean => profile.reportId !== 0;

export const getReportDescriptorOptions = (profile: DeviceProfile): ReportDescriptorOptions => ({
  withReportIds: withReportIds(profile),
  inputLength: profile.reportSize,
});

export const toServiceProfile = (profile: DeviceProfile): ServiceProfile => ({
  instanceId: profile.id,
  vendorId: profile.vendorId,
  productId: profile.productId,
  versionNumber: profile.versionNumber,
  manufacturer: profile.manufacturer,
  product: profile.productName,
  serialNumber: profile.serialNumber,
  reportDescriptorHex: toDescriptorHex(buildReportDescriptor(getReportDescriptorOptions(profile))),
});

/**
 * One input report as it goes on the wire: a profile with report ids prepends its report id, an
 * id-less profile sends the report bytes alone. This is what the driver re-emits verbatim.
 */
export const toWireReport = (profile: DeviceProfile, report: Uint8Array): Uint8Array =>
  withReportIds(profile) ? Uint8Array.of(profile.reportId, ...report) : report;
