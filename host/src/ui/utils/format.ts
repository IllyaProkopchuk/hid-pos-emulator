/** How many bytes of a hex log detail are shown before it is collapsed. */
const HEX_PREVIEW_BYTES = 16;

/** `0x1eab`: a USB vendor or product id the way WebHID apps usually log it. */
export const toHexId = (value: number): string => '0x' + value.toString(16).padStart(4, '0');

/** A log detail that is a space separated hex dump, the only kind worth collapsing. */
export const isHexDetail = (detail: string): boolean => /^[0-9a-f]{2}( [0-9a-f]{2})+$/.test(detail);

const pad = (value: number): string => String(value).padStart(2, '0');

/** `14:05:09` for a scan sent today, `23.09 14:05` for an earlier one. */
export const formatScanTime = (timestamp: number, now = new Date()): string => {
  const date = new Date(timestamp);
  const time = pad(date.getHours()) + ':' + pad(date.getMinutes());

  if (date.toDateString() === now.toDateString()) {
    return time + ':' + pad(date.getSeconds());
  }

  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + ' ' + time;
};

export const getHexPreview =(detail: string): string => {
  const bytes = detail.split(' ');

  if (bytes.length <= HEX_PREVIEW_BYTES) {
    return detail;
  }

  return bytes.slice(0, HEX_PREVIEW_BYTES).join(' ') + ' … (' + bytes.length + ' B)';
};
