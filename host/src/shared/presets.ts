export type PresetId =
  | 'ticketBarcode'
  | 'ticketQrPin'
  | 'cardNumber'
  | 'bookingCode'
  | 'receiptQr'
  | 'custom';

export type Preset = {
  id: PresetId;
  label: string;
  text: string;
  /** What the scan is and how it goes out, shown next to the button in the UI. */
  expected: string;
};

/**
 * Synthetic receipt QR payload in the Austrian RKSV layout: real field order, placeholder values.
 * Only its shape matters: long, and matching none of the other presets' patterns, for testing what
 * an app ignores.
 */
const RECEIPT_QR_TEXT =
  '_R1-AT1_DEMO-CASHBOX-01_AT0000001234_2026-09-03T11:42:07_12,90_0,00_0,00_0,00_0,00_' +
  'kM3xQfT9aQk4Zr1B_3f2a91c4d7e05b18_9pQm2LqV0sZ1c4Xn_' +
  'hR7bK1sYq3Vv8Nn2Tf5Ld9Xa0Pc4Wm6Jt8Rz2Bq4Hy7Ke=';

export const PRESETS: Array<Preset> = [
  {
    id: 'ticketBarcode',
    label: 'Ticket barcode',
    text: '221-3351-753',
    expected: 'Ticket 221-3351-753 without pin, one report',
  },
  {
    id: 'ticketQrPin',
    // 69 characters on purpose: over one 63 byte report, so it splits in two. The tests and
    // docs/verification.md pin the bytes of that split.
    label: 'Ticket QR with pin',
    text: 'https://tickets.example.com/emulator-qr/ticket/505-1786-106?pin=39321',
    expected: 'Ticket 505-1786-106 with pin 39321, split over two Newland reports',
  },
  {
    id: 'cardNumber',
    label: 'Card number',
    text: '1234 5678 9123 4567',
    expected: 'Card 1234567891234567, 16 digits in groups of four',
  },
  {
    id: 'bookingCode',
    label: 'Booking code',
    text: 'L9NV277X',
    expected: 'Booking code L9NV277X, eight characters',
  },
  {
    id: 'receiptQr',
    label: 'Receipt QR',
    text: RECEIPT_QR_TEXT,
    expected: 'A long QR that is none of the above, for testing what the app ignores',
  },
  {
    id: 'custom',
    label: 'Custom',
    text: '',
    expected: 'Whatever is typed into the textarea',
  },
];

export const getPreset = (presetId: string): Preset => {
  const preset = PRESETS.find((item) => item.id === presetId);

  if (typeof preset === 'undefined') {
    throw new Error(`Unknown preset: ${presetId}`);
  }

  return preset;
};
