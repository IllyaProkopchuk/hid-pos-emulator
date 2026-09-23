import type { DeviceProfileId } from '@shared/profiles';
import type { PluggedDevice, ProfileSummary } from '@shared/uiProtocol';

type Props = {
  devices: Array<PluggedDevice>;
  profiles: Array<ProfileSummary>;
  selectedProfileId: DeviceProfileId | null;
  onSelect: (profileId: DeviceProfileId) => void;
};

/** Which plugged device a scan goes out as. Only offers a choice when there is one to make. */
export const SendAs = ({ devices, profiles, selectedProfileId, onSelect }: Props) => {
  if (devices.length === 0 || selectedProfileId === null) {
    return <div className="SendAs" />;
  }

  if (devices.length === 1) {
    const label =
      profiles.find((profile) => profile.id === selectedProfileId)?.label ?? selectedProfileId;

    return (
      <div className="SendAs">
        <span>send as {label}</span>
      </div>
    );
  }

  return (
    <div className="SendAs">
      <span>send as</span>
      {devices.map((device) => (
        <label key={device.profileId}>
          <input
            type="radio"
            name="sendAs"
            value={device.profileId}
            checked={device.profileId === selectedProfileId}
            onChange={() => onSelect(device.profileId)}
          />{' '}
          {device.profileId}
        </label>
      ))}
    </div>
  );
};
