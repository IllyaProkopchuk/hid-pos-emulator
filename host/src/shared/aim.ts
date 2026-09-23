/**
 * AIM symbology identifiers a real scanner prepends to the payload. Keys are the format names
 * `BarcodeDetector` reports; ZXing names are lowercased to match before lookup.
 */
const AIM_PREFIX_BY_FORMAT: Record<string, string> = {
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

const AIM_PREFIX_PATTERN = /^\][A-Za-z][0-9]$/;

export const getAimPrefixForFormat = (format: string): string | null =>
  AIM_PREFIX_BY_FORMAT[format.toLowerCase()] ?? null;

export const isValidAimPrefix = (value: string): boolean => AIM_PREFIX_PATTERN.test(value);

export const getAimPrefixes = (): Record<string, string> => ({ ...AIM_PREFIX_BY_FORMAT });
