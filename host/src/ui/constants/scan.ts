import type { TerminatorName } from '@shared/framing';

import type { ScanSettings } from '@/types';

export const INITIAL_SCAN_SETTINGS: ScanSettings = {
  aimPrefix: '',
  terminator: 'CR',
  delayMs: '5',
  faults: new Set(),
};

/** The prefixes offered even before the host has sent its table. */
export const BUILT_IN_AIM_PREFIXES = [']Q3', ']C0'];

export const TERMINATORS: Array<TerminatorName> = ['CR', 'LF', 'ETX', 'none'];

/** How long a scan result or error stays next to the Scan button. */
export const FEEDBACK_TIMEOUT_MS = 3000;

/** How long the page waits before reconnecting to a host that went away. */
export const RECONNECT_DELAY_MS = 1000;
