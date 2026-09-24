import { DeviceList } from '@/components/devices/DeviceList';
import { StatusBar } from '@/components/header/StatusBar';
import { Log } from '@/components/log/Log';
import { ScanOptions } from '@/components/options/ScanOptions';
import { History } from '@/components/saved/History';
import { StarredCodes } from '@/components/saved/StarredCodes';
import { CustomScan } from '@/components/scan/CustomScan';
import { ImageScan } from '@/components/scan/ImageScan';
import { SendAs } from '@/components/scan/SendAs';
import { useEmulator } from '@/hooks/useEmulator';
import { useSavedCodes } from '@/hooks/useSavedCodes';
import { useScan } from '@/hooks/useScan';
import { canToggleStar, isStarred } from '@/utils/codeHistory';

export const App = () => {
  const { state, connection, feedback, send } = useEmulator();
  const savedCodes = useSavedCodes();
  const scan = useScan(state, send, savedCodes.recordScan);

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
            <StarredCodes
              starred={savedCodes.starred}
              isDisabled={scan.isDisabled}
              onScan={scan.scanCode}
              onRename={savedCodes.rename}
              onUnstar={savedCodes.toggleStar}
            />
            <CustomScan
              text={scan.text}
              source={scan.source}
              feedback={feedback}
              blockedReason={scan.blockedReason}
              isDisabled={scan.isDisabled}
              isStarred={isStarred(savedCodes.starred, scan.currentCode)}
              canToggleStar={canToggleStar(savedCodes.starred, scan.currentCode)}
              onTextChange={scan.setText}
              onScan={scan.scan}
              onToggleStar={() => savedCodes.toggleStar(scan.currentCode)}
            />
            <ImageScan onCode={scan.applyCode} />
          </section>

          <History
            savedCodes={savedCodes}
            isDisabled={scan.isDisabled}
            onLoad={scan.loadCode}
            onScan={scan.scanCode}
          />

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
