import type { Fault, TerminatorName, AimPrefix } from './framing.js';
import type { DeviceProfileId } from './profiles.js';
import type { Preset } from './presets.js';

/**
 * Messages between the host and its own control page. Nothing here reaches the app under test: that
 * app talks to the device through the operating system, not to this process.
 */

export type LogDirection = 'toApp' | 'fromApp' | 'system';

export type LogEntry = {
  id: number;
  time: string;
  direction: LogDirection;
  message: string;
  detail?: string;
};

export type EmulatedDeviceInfo = {
  deviceKey: string;
  vendorId: number;
  productId: number;
  productName: string;
  serialNumber: string;
  /** The HID report id this device's input reports carry; `0` for a profile without report ids. */
  reportId: number;
};

export type PluggedDevice = {
  profileId: DeviceProfileId;
  device: EmulatedDeviceInfo;
  /** Device instance path reported by the service, `SWD\HidPosEmu\<instanceId>`. */
  devicePath: string;
  /**
   * Some application holds a read handle open on the device, which the driver reports as a
   * non-zero pending read count in its status feature report.
   */
  readerActive: boolean;
};

export type ServiceStatus = {
  connected: boolean;
  driverInstalled: boolean;
};

export type ProfileSummary = {
  id: DeviceProfileId;
  label: string;
  vendorId: number;
  productId: number;
  reportSize: number;
  maxPayloadBytes: number;
  hasLengthByte: boolean;
};

export type EmulatorStateSnapshot = {
  port: number;
  /** Format to AIM identifier, so the page does not duplicate the table. */
  aimPrefixes: Record<string, string>;
  service: ServiceStatus;
  devices: Array<PluggedDevice>;
  profiles: Array<ProfileSummary>;
  presets: Array<Preset>;
  log: Array<LogEntry>;
};

export type ScanOptions = {
  aimPrefix?: AimPrefix;
  terminator?: TerminatorName;
  delayMs?: number;
  faults?: Array<Fault>;
};

/** Where the scan text came from; only used to label the log line. */
export type ScanSource = { kind: 'image'; fileName: string; format: string };

export type ScanRequest = {
  text?: string;
  presetId?: string;
  profileId?: string;
  options?: ScanOptions;
  source?: ScanSource;
};

export type UiToEmulatorMessage =
  | { type: 'ui-hello' }
  | { type: 'ui-plug'; profileId: string }
  | { type: 'ui-unplug'; profileId: string }
  | ({ type: 'ui-scan' } & ScanRequest)
  | { type: 'ui-clear-log' };

export type EmulatorToUiMessage =
  | { type: 'ui-state'; state: EmulatorStateSnapshot }
  /** Answer to `ui-scan`, sent only to the page that asked for the scan. */
  | { type: 'ui-scan-result'; reportCount: number }
  | { type: 'ui-error'; message: string };
