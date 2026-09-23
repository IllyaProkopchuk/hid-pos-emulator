import type { Preset } from '@shared/presets';

type Props = {
  presets: Array<Preset>;
  isDisabled: boolean;
  onScan: (presetId: string) => void;
};

export const PresetGrid = ({ presets, isDisabled, onScan }: Props) => (
  <div className="PresetGrid">
    {presets
      // `custom` is what the text box sends; it has no button of its own.
      .filter((preset) => preset.id !== 'custom')
      .map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="Preset"
          disabled={isDisabled}
          onClick={() => onScan(preset.id)}
        >
          <span className="PresetName">{preset.label}</span>
          <span className="PresetText" title={preset.text}>
            {preset.text}
          </span>
          <span className="PresetExpected">{preset.expected}</span>
        </button>
      ))}
  </div>
);
