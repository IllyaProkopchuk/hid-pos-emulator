import { DEVICE_PROFILES, type DeviceProfile, type DeviceProfileId } from '../shared/profiles.js';
import { getAimPrefixes } from '../shared/aim.js';
import { PRESETS } from '../shared/presets.js';
import type {
  EmulatedDeviceInfo,
  EmulatorStateSnapshot,
  LogDirection,
  LogEntry,
  PluggedDevice,
  ServiceStatus,
} from '../shared/uiProtocol.js';

const MAX_LOG_ENTRIES = 500;

const toDeviceInfo = (profile: DeviceProfile): EmulatedDeviceInfo => ({
  deviceKey: `${profile.id}:${profile.serialNumber}`,
  vendorId: profile.vendorId,
  productId: profile.productId,
  productName: profile.productName,
  serialNumber: profile.serialNumber,
  reportId: profile.reportId,
});

export class EmulatorState {
  private readonly devices = new Map<DeviceProfileId, PluggedDevice>();

  private readonly log: Array<LogEntry> = [];

  private readonly listeners = new Set<() => void>();

  private service: ServiceStatus = { connected: false, driverInstalled: false };

  private logSequence = 0;

  public constructor(private readonly port: number) {}

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public setServiceStatus(status: ServiceStatus): void {
    this.service = status;

    if (!status.connected) {
      // The devices belong to the service; when it goes away nothing is plugged in any more.
      this.devices.clear();
    }

    this.notify();
  }

  public getServiceStatus(): ServiceStatus {
    return this.service;
  }

  public plugDevice(profile: DeviceProfile, devicePath: string): PluggedDevice {
    const existing = this.devices.get(profile.id);

    if (typeof existing !== 'undefined') {
      return existing;
    }

    const device: PluggedDevice = {
      profileId: profile.id,
      device: toDeviceInfo(profile),
      devicePath,
      readerActive: false,
    };

    this.devices.set(profile.id, device);
    this.appendLog('toApp', `plugged in ${profile.label}`, devicePath);

    return device;
  }

  public unplugDevice(profileId: DeviceProfileId): PluggedDevice | null {
    const device = this.devices.get(profileId);

    if (typeof device === 'undefined') {
      return null;
    }

    this.devices.delete(profileId);
    this.appendLog('toApp', `unplugged ${profileId}`, device.devicePath);

    return device;
  }

  public setReaderActive(profileId: string, readerActive: boolean): void {
    const device = this.devices.get(profileId as DeviceProfileId);

    if (typeof device === 'undefined' || device.readerActive === readerActive) {
      return;
    }

    device.readerActive = readerActive;
    this.appendLog(
      'fromApp',
      `${profileId} ${readerActive ? 'opened by an application' : 'no longer read by any application'}`,
    );
  }

  public getPluggedDevices(): Array<PluggedDevice> {
    return Array.from(this.devices.values());
  }

  public appendLog(direction: LogDirection, message: string, detail?: string): void {
    this.logSequence += 1;
    this.log.push({
      id: this.logSequence,
      time: new Date().toISOString().slice(11, 23),
      direction,
      message,
      detail,
    });

    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    }

    this.notify();
  }

  public clearLog(): void {
    this.log.length = 0;
    this.notify();
  }

  public getSnapshot(): EmulatorStateSnapshot {
    return {
      port: this.port,
      aimPrefixes: getAimPrefixes(),
      service: this.service,
      devices: this.getPluggedDevices(),
      profiles: Object.values(DEVICE_PROFILES).map((profile) => ({
        id: profile.id,
        label: profile.label,
        vendorId: profile.vendorId,
        productId: profile.productId,
        reportSize: profile.reportSize,
        maxPayloadBytes: profile.maxPayloadBytes,
        hasLengthByte: profile.hasLengthByte,
      })),
      presets: PRESETS,
      log: this.log,
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
