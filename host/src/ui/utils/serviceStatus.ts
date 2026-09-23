import type { EmulatorStateSnapshot } from '@shared/uiProtocol';

export const INSTALL_HINT = 'run installer\\install.ps1 as administrator';

export type ServiceState = {
  isOn: boolean;
  text: string;
  hint: string | null;
};

export const getServiceState = (state: EmulatorStateSnapshot): ServiceState => {
  if (!state.service.connected) {
    return { isOn: false, text: 'Service: disconnected', hint: INSTALL_HINT };
  }

  if (!state.service.driverInstalled) {
    return { isOn: false, text: 'Service: connected, driver missing', hint: INSTALL_HINT };
  }

  return { isOn: true, text: 'Service: connected, driver installed', hint: null };
};

/**
 * Why nothing can be scanned right now, or `null` when a scan can go out. Presets and the Scan
 * button are disabled while this is non-null, and the reason is shown under the text box.
 */
export const getBlockedReason = (state: EmulatorStateSnapshot): string | null => {
  if (state.devices.length === 0) {
    return 'Plug in a device first';
  }

  if (!state.service.connected) {
    return 'HidPosEmuSvc is not running — ' + INSTALL_HINT;
  }

  return null;
};
