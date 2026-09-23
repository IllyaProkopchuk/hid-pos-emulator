import type { PluggedDevice, ProfileSummary } from '@shared/uiProtocol';

import { Dot } from '@/components/common/Dot';
import { toHexId } from '@/utils/format';

type Props = {
  profile: ProfileSummary;
  /** The plugged device for this profile, or `undefined` while it is unplugged. */
  plugged: PluggedDevice | undefined;
  onToggle: () => void;
};

export const DeviceCard = ({ profile, plugged, onToggle }: Props) => (
  <div className={plugged ? 'Device Device-plugged' : 'Device'}>
    <div className="DeviceName">{profile.label}</div>
    <div className="DeviceMeta">
      {toHexId(profile.vendorId)} / {toHexId(profile.productId)}
    </div>
    <div className="DeviceMeta">
      {profile.reportSize} B · {profile.hasLengthByte ? 'length byte' : 'raw text'}
    </div>

    <div className="Indicators">
      <div className="Indicator">
        <Dot isOn={Boolean(plugged)} />
        <span>plugged</span>
      </div>
      {/*
        The driver counts the read requests hidclass keeps pending, which is non-zero exactly while
        some application holds the device open: Chrome after device.open().
      */}
      {plugged && (
        <div className="Indicator">
          <Dot isOn={plugged.readerActive} />
          <span>{plugged.readerActive ? 'app reading' : 'no app reading'}</span>
        </div>
      )}
    </div>

    <button type="button" className={plugged ? 'Toggle-on' : undefined} onClick={onToggle}>
      {plugged ? 'Unplug' : 'Plug in'}
    </button>
  </div>
);
