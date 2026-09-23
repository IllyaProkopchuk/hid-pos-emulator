import type { Fault, TerminatorName } from '@shared/framing';

import { FaultList } from '@/components/options/FaultList';
import { BUILT_IN_AIM_PREFIXES, TERMINATORS } from '@/constants/scan';
import type { ScanSettings } from '@/types';

type Props = {
  settings: ScanSettings;
  /** Format to AIM identifier, as the host reports it. */
  aimPrefixes: Record<string, string>;
  hasLengthByte: boolean;
  onChange: (settings: ScanSettings) => void;
};

/** How the next scan is framed: AIM prefix, terminator, pacing and injected faults. */
export const ScanOptions = ({ settings, aimPrefixes, hasLengthByte, onChange }: Props) => {
  const extraPrefixes = Array.from(new Set(Object.values(aimPrefixes)))
    .filter((prefix) => !BUILT_IN_AIM_PREFIXES.includes(prefix))
    .sort();

  const toggleFault = (fault: Fault, isOn: boolean) => {
    const faults = new Set(settings.faults);

    if (isOn) {
      faults.add(fault);
    } else {
      faults.delete(fault);
    }

    onChange({ ...settings, faults });
  };

  return (
    <>
      <div className="Fields">
        <label className="Field">
          <span className="FieldLabel">AIM prefix</span>
          <select
            value={settings.aimPrefix}
            onChange={(event) => onChange({ ...settings, aimPrefix: event.target.value })}
          >
            <option value="">off</option>
            {[...BUILT_IN_AIM_PREFIXES, ...extraPrefixes].map((prefix) => (
              <option key={prefix} value={prefix}>
                {prefix}
              </option>
            ))}
          </select>
        </label>
        <label className="Field">
          <span className="FieldLabel">Terminator</span>
          <select
            value={settings.terminator}
            onChange={(event) =>
              onChange({ ...settings, terminator: event.target.value as TerminatorName })
            }
          >
            {TERMINATORS.map((terminator) => (
              <option key={terminator} value={terminator}>
                {terminator}
              </option>
            ))}
          </select>
        </label>
        <label className="Field">
          <span className="FieldLabel">Delay between reports (ms)</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={settings.delayMs}
            onChange={(event) => onChange({ ...settings, delayMs: event.target.value })}
          />
        </label>
      </div>

      <h3>Fault injection</h3>
      <FaultList selected={settings.faults} hasLengthByte={hasLengthByte} onToggle={toggleFault} />
    </>
  );
};
