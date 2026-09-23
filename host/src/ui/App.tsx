import { DeviceList } from '@/components/devices/DeviceList';
import { StatusBar } from '@/components/header/StatusBar';
import { Log } from '@/components/log/Log';
import { ScanOptions } from '@/components/options/ScanOptions';
import { CustomScan } from '@/components/scan/CustomScan';
import { ImageScan } from '@/components/scan/ImageScan';
import { SendAs } from '@/components/scan/SendAs';
import { useEmulator } from '@/hooks/useEmulator';
import { useScan } from '@/hooks/useScan';

export const App = () => {
  const { state, connection, feedback, send } = useEmulator();
  const scan = useScan(state, send);

  const devices = state?.devices ?? [];
  const profiles = state?.profiles ?? [];

  return (
    <div className="Page">
      <header>
        <h1>HID-POS emulator</h1>
        <StatusBar state={state} connection={connection} />
      </header>

      <div className="Layout">
        <div>
          <section>
            <h2>Devices</h2>
            <DeviceList
              profiles={profiles}
              devices={devices}
              onToggle={(profileId, isPlugged) =>
                send({ type: isPlugged ? 'ui-unplug' : 'ui-plug', profileId })
              }
            />
          </section>

          <section>
            <h2>Scan</h2>
            <SendAs
              devices={devices}
              profiles={profiles}
              selectedProfileId={scan.profileId}
              onSelect={scan.chooseProfile}
            />
            <CustomScan
              text={scan.text}
              source={scan.source}
              feedback={feedback}
              blockedReason={scan.blockedReason}
              isDisabled={scan.isDisabled}
              onTextChange={scan.setText}
              onScan={scan.scan}
            />
            <ImageScan onCode={scan.applyCode} />
          </section>

          <section>
            <h2>Options</h2>
            <ScanOptions
              settings={scan.settings}
              aimPrefixes={state?.aimPrefixes ?? {}}
              hasLengthByte={scan.hasLengthByte}
              onChange={scan.setSettings}
            />
          </section>
        </div>

        <div className="LogColumn">
          <Log entries={state?.log ?? []} onClear={() => send({ type: 'ui-clear-log' })} />
        </div>
      </div>
    </div>
  );
};
