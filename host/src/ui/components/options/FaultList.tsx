import type { Fault } from '@shared/framing';

import { FAULTS } from '@/constants/faults';

type Props = {
  selected: ReadonlySet<Fault>;
  /** Whether the profile the scan goes out as has a length byte for a fault to remove. */
  hasLengthByte: boolean;
  onToggle: (fault: Fault, isOn: boolean) => void;
};

export const FaultList = ({ selected, hasLengthByte, onToggle }: Props) => (
  <div>
    {FAULTS.map((fault) => {
      // Grey out a fault that cannot do anything on this profile, so an enabled checkbox always
      // means an effect is expected.
      const isSupported = !fault.requiresLengthByte || hasLengthByte;

      return (
        <label
          key={fault.id}
          className="Fault"
          title={
            isSupported ? '' : 'This profile has no length byte, so this fault would change nothing'
          }
        >
          <input
            type="checkbox"
            disabled={!isSupported}
            checked={isSupported && selected.has(fault.id)}
            onChange={(event) => onToggle(fault.id, event.target.checked)}
          />
          <span>
            <div className="FaultName">{fault.name}</div>
            <div className="FaultDescription">{fault.description}</div>
          </span>
        </label>
      );
    })}
  </div>
);
