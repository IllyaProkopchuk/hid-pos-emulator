import type { ScanSource } from '@shared/uiProtocol';

type Props = {
  text: string;
  source: ScanSource | null;
  feedback: string;
  blockedReason: string | null;
  isDisabled: boolean;
  /** The text box, with its AIM prefix, is among the starred codes. */
  isStarred: boolean;
  /** False while every star slot is taken and the text box is not one of them. */
  canToggleStar: boolean;
  onTextChange: (text: string) => void;
  onScan: () => void;
  onToggleStar: () => void;
};

/** Free text scan: the text box, the Scan button and what came back. */
export const CustomScan = ({
  text,
  source,
  feedback,
  blockedReason,
  isDisabled,
  isStarred,
  canToggleStar,
  onTextChange,
  onScan,
  onToggleStar,
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
      <button
        type="button"
        className={isStarred ? 'Toggle-on' : undefined}
        disabled={text === '' || !canToggleStar}
        title={
          canToggleStar
            ? isStarred
              ? 'Unpin from above the text box'
              : 'Pin above the text box, one click from a scan'
            : 'Every star is taken; unstar a code first'
        }
        onClick={onToggleStar}
      >
        {isStarred ? '★ Saved' : '☆ Save'}
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
