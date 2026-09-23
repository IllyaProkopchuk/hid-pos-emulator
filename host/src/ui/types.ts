import type { Fault, TerminatorName } from '@shared/framing';
import type { ScanSource } from '@shared/uiProtocol';

/** The scan options the user has set on the page. */
export type ScanSettings = {
  /** Empty string means no AIM prefix. */
  aimPrefix: string;
  terminator: TerminatorName;
  /** Kept as typed so the field can be edited freely; converted when a scan goes out. */
  delayMs: string;
  faults: ReadonlySet<Fault>;
};

/**
 * What a custom scan sends. Passed explicitly when a scan fires in the same tick as the update that
 * produced it, because React has not re-rendered with the new values yet.
 */
export type CustomScanInput = {
  text: string;
  aimPrefix: string;
  source: ScanSource | null;
};
