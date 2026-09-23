import { useEffect, useState } from 'react';

import type { DeviceProfileId } from '@shared/profiles';
import type { EmulatorStateSnapshot, ScanSource, UiToEmulatorMessage } from '@shared/uiProtocol';

import { FAULTS } from '@/constants/faults';
import { INITIAL_SCAN_SETTINGS } from '@/constants/scan';
import type { CustomScanInput, ScanSettings } from '@/types';
import type { DecodedCode } from '@/utils/barcodeDecoder';
import { getBlockedReason } from '@/utils/serviceStatus';

export type Scan = {
  /** The device a scan goes out as: the user's choice while it is plugged, else the first plugged. */
  profileId: DeviceProfileId | null;
  chooseProfile: (profileId: DeviceProfileId) => void;
  text: string;
  setText: (text: string) => void;
  source: ScanSource | null;
  settings: ScanSettings;
  setSettings: (settings: ScanSettings) => void;
  hasLengthByte: boolean;
  /** Why a scan cannot go out right now, shown under the text box; `null` when it can. */
  blockedReason: string | null;
  isDisabled: boolean;
  /** Send what is in the text box. */
  scan: () => void;
  /** Apply a code decoded from a photo, and scan it straight away if asked to. */
  applyCode: (code: DecodedCode, fileName: string, shouldScan: boolean) => void;
};

/** Everything the page knows about the next scan, and the one function that sends it. */
export const useScan = (
  state: EmulatorStateSnapshot | null,
  send: (message: UiToEmulatorMessage) => void,
): Scan => {
  const [chosenProfileId, setChosenProfileId] = useState<DeviceProfileId | null>(null);
  const [text, setTextValue] = useState('');
  const [source, setSource] = useState<ScanSource | null>(null);
  const [settings, setSettings] = useState<ScanSettings>(INITIAL_SCAN_SETTINGS);

  const devices = state?.devices ?? [];
  const profileId = devices.some((device) => device.profileId === chosenProfileId)
    ? chosenProfileId
    : (devices[0]?.profileId ?? null);
  const hasLengthByte = Boolean(
    state?.profiles.find((profile) => profile.id === profileId)?.hasLengthByte,
  );

  const blockedReason = state === null ? null : getBlockedReason(state);
  const isDisabled = state === null || blockedReason !== null;

  // A fault that needs a length byte is switched off, not merely hidden, when the profile has none,
  // so switching back to a profile with one does not silently re-enable it.
  useEffect(() => {
    if (hasLengthByte) {
      return;
    }

    setSettings((current) => {
      const faults = new Set(current.faults);
      let hasChanged = false;

      FAULTS.forEach((fault) => {
        if (fault.requiresLengthByte && faults.delete(fault.id)) {
          hasChanged = true;
        }
      });

      return hasChanged ? { ...current, faults } : current;
    });
  }, [hasLengthByte]);

  // The page only scans what is in the text box; the host's other presets are for POST /scan.
  const sendScan = (input: CustomScanInput) => {
    send({
      type: 'ui-scan',
      presetId: 'custom',
      text: input.text,
      profileId: profileId ?? undefined,
      options: {
        aimPrefix: input.aimPrefix || null,
        terminator: settings.terminator,
        delayMs: Number(settings.delayMs),
        faults: FAULTS.map((fault) => fault.id).filter((fault) => settings.faults.has(fault)),
      },
      source: input.source ?? undefined,
    });
  };

  const scan = () => sendScan({ text, aimPrefix: settings.aimPrefix, source });

  const applyCode = (code: DecodedCode, fileName: string, shouldScan: boolean) => {
    const decoded: CustomScanInput = {
      text: code.text,
      aimPrefix: state?.aimPrefixes[code.format] ?? '',
      source: { kind: 'image', fileName, format: code.format },
    };

    setTextValue(decoded.text);
    setSettings((current) => ({ ...current, aimPrefix: decoded.aimPrefix }));
    setSource(decoded.source);

    if (shouldScan && !isDisabled) {
      // The state above has not re-rendered yet, so the decoded values are passed in directly.
      sendScan(decoded);
    }
  };

  const setText = (value: string) => {
    setTextValue(value);
    // Typed text no longer came from the photo.
    setSource(null);
  };

  return {
    profileId,
    chooseProfile: setChosenProfileId,
    text,
    setText,
    source,
    settings,
    setSettings,
    hasLengthByte,
    blockedReason,
    isDisabled,
    scan,
    applyCode,
  };
};
