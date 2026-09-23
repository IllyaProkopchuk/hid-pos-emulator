import type { EmulatorStateSnapshot } from '@shared/uiProtocol';

import { Dot } from '@/components/common/Dot';
import type { Connection } from '@/hooks/useEmulator';
import { getServiceState } from '@/utils/serviceStatus';

type Props = {
  state: EmulatorStateSnapshot | null;
  connection: Connection;
};

export const StatusBar = ({ state, connection }: Props) => {
  if (connection === 'offline') {
    return <div className="Status">host offline, reconnecting…</div>;
  }

  if (state === null) {
    return <div className="Status" />;
  }

  const service = getServiceState(state);

  return (
    <div className="Status">
      <Dot isOn={service.isOn} />
      <span>{service.text}</span>
      {service.hint && <span className="Badge">{service.hint}</span>}
    </div>
  );
};
