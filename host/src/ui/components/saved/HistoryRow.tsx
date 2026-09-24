import type { HistoryEntry } from '@/utils/codeHistory';
import { formatScanTime } from '@/utils/format';

type Props = {
  entry: HistoryEntry;
  isStarred: boolean;
  /** False while every star slot is taken and this code is not one of them. */
  canToggleStar: boolean;
  isDisabled: boolean;
  onToggleStar: () => void;
  /** Put the code into the text box, to edit it before scanning. */
  onLoad: () => void;
  onScan: () => void;
};

/** One recent scan: star it, load it into the text box, or send it again with one click. */
export const HistoryRow = ({
  entry,
  isStarred,
  canToggleStar,
  isDisabled,
  onToggleStar,
  onLoad,
  onScan,
}: Props) => {
  let starTitle = isStarred ? 'Unstar' : 'Star, to pin it above the text box';

  if (!canToggleStar) {
    starTitle = 'Every star is taken; unstar a code first';
  }

  return (
    <div className="HistoryRow">
      <button
        type="button"
        className={isStarred ? 'IconButton Star-on' : 'IconButton'}
        title={starTitle}
        aria-label={isStarred ? 'Unstar' : 'Star'}
        aria-pressed={isStarred}
        disabled={!canToggleStar}
        onClick={onToggleStar}
      >
        {isStarred ? '★' : '☆'}
      </button>
      <button
        type="button"
        className="HistoryCode"
        title={'Put into the text box\n\n' + entry.text}
        onClick={onLoad}
      >
        {entry.aimPrefix && <span className="CodeFormat">{entry.aimPrefix}</span>}
        {entry.format && <span className="CodeFormat">{entry.format}</span>}
        <span className="CodeText">{entry.text}</span>
      </button>
      <span className="EntryTime">{formatScanTime(entry.scannedAt)}</span>
      <button type="button" className="LinkButton" disabled={isDisabled} onClick={onScan}>
        Scan
      </button>
    </div>
  );
};
