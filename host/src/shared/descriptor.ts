/**
 * HID report descriptors handed to the driver as opaque bytes (device property
 * `DEVPKEY_HidPosEmu_ReportDescriptor`). The driver never parses them; hidclass does, and the
 * collections it derives are what WebHID reports and apps key a device on, so these bytes must
 * stay stable per profile.
 *
 * Layout, both variants: one application collection on usage page 0x8C (Bar Code Scanner) with an
 * input report of `inputLength` bytes, a 64 byte output report and a 2 byte feature report on a
 * vendor usage page. The output report is the injection channel (the service writes the input
 * report to emit into its body); the feature report carries the driver status.
 */

export const INPUT_REPORT_ID = 2;

export const OUTPUT_REPORT_ID = 3;

export const STATUS_REPORT_ID = 4;

export const OUTPUT_REPORT_LENGTH = 64;

export const STATUS_REPORT_LENGTH = 2;

export type ReportDescriptorOptions = {
  /** `false` drops every `Report ID` item, which is what the `generic` profile needs. */
  withReportIds: boolean;
  /** Bytes of one input report, excluding the report id byte. */
  inputLength: number;
};

const USAGE_PAGE_BAR_CODE_SCANNER = 0x8c;

/**
 * Usage 0x03 (Dumb Bar Code Scanner), not 0x02 (Bar Code Scanner), and that is deliberate.
 *
 * Windows ships `hidscanner.inf`, whose one and only compatible id is `HID_DEVICE_UP:008C_U:0002`.
 * Declaring usage 0x02 therefore hands the collection to Microsoft's own POS barcode class driver,
 * which will not start on this descriptor: the child devnode ends up in `CM_PROB_FAILED_START`
 * (Code 10, `STATUS_DEVICE_POWER_FAILURE`) and never publishes a HID interface, so Chrome sees
 * nothing at all. No inbox INF claims any other usage on this page, so 0x03 leaves the collection
 * with the generic HID driver, which is all WebHID needs.
 *
 * Nothing downstream cares: a WebHID filter for scanners matches on the usage page, not the usage.
 */
const USAGE_BAR_CODE_SCANNER = 0x03;
const USAGE_DECODED_DATA = 0xfe;
const VENDOR_USAGE_INJECT = 0x01;
const VENDOR_USAGE_STATUS = 0x02;

export const buildReportDescriptor = ({
  withReportIds,
  inputLength,
}: ReportDescriptorOptions): Uint8Array => {
  if (!Number.isInteger(inputLength) || inputLength < 1 || inputLength > 255) {
    throw new Error(`Input report length out of range: ${inputLength}`);
  }

  const reportId = (id: number): Array<number> => (withReportIds ? [0x85, id] : []);

  return Uint8Array.from([
    0x05, USAGE_PAGE_BAR_CODE_SCANNER, // Usage Page (Bar Code Scanner)
    0x09, USAGE_BAR_CODE_SCANNER, //      Usage (Bar Code Scanner)
    0xa1, 0x01, //                        Collection (Application)
    ...reportId(INPUT_REPORT_ID),
    0x09, USAGE_DECODED_DATA, //            Usage (Decoded Data)
    0x15, 0x00, //                          Logical Minimum (0)
    0x26, 0xff, 0x00, //                    Logical Maximum (255)
    0x75, 0x08, //                          Report Size (8)
    0x95, inputLength, //                   Report Count (inputLength)
    0x81, 0x02, //                          Input (Data,Var,Abs)
    ...reportId(OUTPUT_REPORT_ID),
    0x06, 0x00, 0xff, //                    Usage Page (Vendor 0xFF00)
    0x09, VENDOR_USAGE_INJECT, //           Usage (1) - injection channel
    0x95, OUTPUT_REPORT_LENGTH, //          Report Count (64)
    0x91, 0x02, //                          Output (Data,Var,Abs)
    ...reportId(STATUS_REPORT_ID),
    0x09, VENDOR_USAGE_STATUS, //           Usage (2) - driver status
    0x95, STATUS_REPORT_LENGTH, //          Report Count (2)
    0xb1, 0x02, //                          Feature (Data,Var,Abs)
    0xc0, //                              End Collection
  ]);
};

export const toDescriptorHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
