import { useRef, useState } from 'react';

import { useImageDecoder } from '@/hooks/useImageDecoder';
import type { DecodedCode } from '@/utils/barcodeDecoder';

type Props = {
  /**
   * A code was picked, either because the photo held exactly one or because the user clicked it in
   * the list. `shouldScan` is true only in the first case, and only if "scan right after decode" is on.
   */
  onCode: (code: DecodedCode, fileName: string, shouldScan: boolean) => void;
};

/** Scan from a photo: drop, paste or choose a file, then pick the code if there are several. */
export const ImageScan = ({ onCode }: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [shouldScanAfterDecode, setShouldScanAfterDecode] = useState(true);
  const { decoded, error, decodeFile } = useImageDecoder((code, fileName) =>
    onCode(code, fileName, shouldScanAfterDecode),
  );

  return (
    <div className="Image">
      <div
        className={isDragging ? 'DropZone DropZone-active' : 'DropZone'}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);

          const file = event.dataTransfer.files[0];

          if (file) {
            void decodeFile(file);
          }
        }}
      >
        Drop a photo, paste (⌘V) or choose a file
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            void decodeFile(file);
          }

          // Reset, so choosing the same file again still fires a change.
          event.target.value = '';
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={shouldScanAfterDecode}
          onChange={(event) => setShouldScanAfterDecode(event.target.checked)}
        />{' '}
        Scan right after decode
      </label>
      <div className="Error" hidden={error === null}>
        {error ?? ''}
      </div>
      <div className="Codes">
        {decoded?.codes.map((code, index) => (
          <button
            key={index}
            type="button"
            className="Code"
            onClick={() => onCode(code, decoded.fileName, false)}
          >
            <span className="CodeFormat">{code.format}</span>
            <span className="CodeText" title={code.text}>
              {code.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
