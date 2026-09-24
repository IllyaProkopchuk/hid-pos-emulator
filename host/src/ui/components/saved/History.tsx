import { HistoryRow } from '@/components/saved/HistoryRow';
import type { SavedCodes } from '@/hooks/useSavedCodes';
import { canToggleStar, HISTORY_LIMIT, isStarred, type SavedCode } from '@/utils/codeHistory';

type Props = {
  savedCodes: SavedCodes;
  isDisabled: boolean;
  onLoad: (code: SavedCode) => void;
  onScan: (code: SavedCode) => void;
};

/** The last scans sent from this page, newest first. */
export const History = ({ savedCodes, isDisabled, onLoad, onScan }: Props) => {
  const { history, starred, toggleStar, clearHistory } = savedCodes;

  return (
    <section>
      <div className="SectionHeader">
        <h2>History</h2>
        <button type="button" hidden={history.length === 0} onClick={clearHistory}>
          Clear
        </button>
      </div>
      {history.length === 0 ? (
        <div className="Empty">The last {HISTORY_LIMIT} scans from this page show up here</div>
      ) : (
        <div className="HistoryList">
          {history.map((entry) => (
            <HistoryRow
              key={entry.aimPrefix + '\n' + entry.text}
              entry={entry}
              isStarred={isStarred(starred, entry)}
              canToggleStar={canToggleStar(starred, entry)}
              isDisabled={isDisabled}
              onToggleStar={() => toggleStar(entry)}
              onLoad={() => onLoad(entry)}
              onScan={() => onScan(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
};
