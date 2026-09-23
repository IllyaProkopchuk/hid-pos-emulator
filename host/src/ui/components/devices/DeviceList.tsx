import type { PluggedDevice, ProfileSummary } from '@shared/uiProtocol';

import { DeviceCard } from '@/components/devices/DeviceCard';

type Props = {
  profiles: Array<ProfileSummary>;
  devices: Array<PluggedDevice>;
  onToggle: (profileId: ProfileSummary['id'], isPlugged: boolean) => void;
};

/** One card per profile the host knows, plugged or not. */
export const DeviceList = ({ profiles, devices, onToggle }: Props) => (
  <div className="DeviceGrid">
    {profiles.map((profile) => {
      const plugged = devices.find((device) => device.profileId === profile.id);

      return (
        <DeviceCard
          key={profile.id}
          profile={profile}
          plugged={plugged}
          onToggle={() => onToggle(profile.id, Boolean(plugged))}
        />
      );
    })}
  </div>
);
