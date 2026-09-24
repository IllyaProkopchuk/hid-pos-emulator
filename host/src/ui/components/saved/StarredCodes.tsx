import { StarTile } from '@/components/saved/StarTile';
import { STARRED_LIMIT, type SavedCode, type StarredCode } from '@/utils/codeHistory';

type Props = {
  starred: Array<StarredCode>;
  isDisabled: boolean;
  onScan: (code: SavedCode) => void;
  onRename: (code: SavedCode, label: string) => void;
  onUnstar: (code: SavedCode) => void;
};

/** The starred codes, one click from a scan, where the preset buttons used to be. */
export const StarredCodes = ({ starred, isDisabled, onScan, onRename, onUnstar }: Props) => {
  if (starred.length === 0) {
    return (
      <div className="StarredHint">
        ☆ Star up to {STARRED_LIMIT} codes to keep them here, one click from a scan
      </div>
    );
  }

  return (
    <div className="StarGrid">
      {starred.map((code) => (
        <StarTile
          key={code.aimPrefix + '\n' + code.text}
          code={code}
          isDisabled={isDisabled}
          onScan={() => onScan(code)}
          onRename={(label) => onRename(code, label)}
          onUnstar={() => onUnstar(code)}
        />
      ))}
    </div>
  );
};
