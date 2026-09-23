import type { ScanSource } from '@shared/uiProtocol';

type Props = {
  text: string;
  source: ScanSource | null;
  feedback: string;
  blockedReason: string | null;
  isDisabled: boolean;
  onTextChange: (text: string) => void;
  onScan: () => void;
};

/** Free text scan: the text box, the Scan button and what came back. */
export const CustomScan = ({
  text,
  source,
  feedback,
  blockedReason,
  isDisabled,
  onTextChange,
  onScan,
}: Props) => (
  <div className="Custom">
    <textarea
      placeholder="Custom scan text — Cmd/Ctrl+Enter to scan"
      value={text}
      onChange={(event) => onTextChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isDisabled) {
          onScan();
        }
      }}
    />
    <div className="ScanBar">
      <button type="button" className="Primary" disabled={isDisabled} onClick={onScan}>
        Scan
      </button>
      <span className="Feedback">{feedback}</span>
    </div>
    <div className="Hint" hidden={blockedReason === null}>
      {blockedReason ?? ''}
    </div>
    <div className="SourceBadge" hidden={source === null}>
      {source === null ? '' : 'from image: ' + source.fileName + ' · ' + source.format}
    </div>
  </div>
);
