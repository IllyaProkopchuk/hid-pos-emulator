import { useState } from 'react';

import { LabelInput } from '@/components/saved/LabelInput';
import type { StarredCode } from '@/utils/codeHistory';

type Props = {
  code: StarredCode;
  isDisabled: boolean;
  onScan: () => void;
  onRename: (label: string) => void;
  onUnstar: () => void;
};

/**
 * A starred code pinned above the text box. The tile itself scans; renaming and unstarring sit in
 * its corner, outside the scan button, because a button cannot hold other buttons.
 */
export const StarTile = ({ code, isDisabled, onScan, onRename, onUnstar }: Props) => {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="StarTile">
      {isEditing ? (
        <div className="StarTileBody">
          <LabelInput
            label={code.label}
            onSave={(label) => {
              onRename(label);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
          />
          <span className="StarTileText">{code.text}</span>
        </div>
      ) : (
        <button
          type="button"
          className="StarTileBody StarTileScan"
          disabled={isDisabled}
          title={'Scan\n\n' + code.text}
          onClick={onScan}
        >
          <span className={code.label ? 'StarTileName' : 'StarTileName StarTileName-empty'}>
            {code.label || 'Unnamed'}
          </span>
          <span className="StarTileCode">
            {code.aimPrefix && <span className="CodeFormat">{code.aimPrefix}</span>}
            <span className="StarTileText">{code.text}</span>
          </span>
        </button>
      )}
      <div className="StarTileActions" hidden={isEditing}>
        <button
          type="button"
          className="IconButton"
          title="Rename"
          aria-label="Rename"
          onClick={() => setIsEditing(true)}
        >
          ✎
        </button>
        <button
          type="button"
          className="IconButton"
          title="Unstar"
          aria-label="Unstar"
          onClick={onUnstar}
        >
          ✕
        </button>
      </div>
    </div>
  );
};
