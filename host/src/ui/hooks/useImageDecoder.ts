import { useEffect, useRef, useState } from 'react';

import { decodeImageFile, type DecodedCode } from '@/utils/barcodeDecoder';

export type DecodedImage = {
  codes: Array<DecodedCode>;
  fileName: string;
};

export type ImageDecoder = {
  decoded: DecodedImage | null;
  error: string | null;
  decodeFile: (file: File) => Promise<void>;
};

/**
 * Decodes photos of barcodes, from a file, a drop or a paste anywhere on the page.
 *
 * `onSingleCode` fires when a photo holds exactly one code, which is the case the page acts on by
 * itself; with several, the user picks one from `decoded.codes`.
 */
export const useImageDecoder = (
  onSingleCode: (code: DecodedCode, fileName: string) => void,
): ImageDecoder => {
  const [decoded, setDecoded] = useState<DecodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decodeFile = async (file: File) => {
    setError(null);
    setDecoded(null);

    let codes: Array<DecodedCode>;

    try {
      codes = await decodeImageFile(file);
    } catch (decodeError) {
      setError(decodeError instanceof Error ? decodeError.message : String(decodeError));
      return;
    }

    const [firstCode] = codes;

    if (firstCode === undefined) {
      setError('No barcode found — try a sharper, closer photo');
      return;
    }

    setDecoded({ codes, fileName: file.name });

    if (codes.length === 1) {
      onSingleCode(firstCode, file.name);
    }
  };

  // The paste listener lives on the document for the page's lifetime, so it reads the latest
  // decodeFile through a ref instead of the one from the first render.
  const decodeFileRef = useRef(decodeFile);

  decodeFileRef.current = decodeFile;

  // Only image pastes are intercepted; pasting text into the text box stays native.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((clipboardItem) =>
        clipboardItem.type.startsWith('image/'),
      );
      const file = item?.getAsFile();

      if (!file) {
        return;
      }

      event.preventDefault();
      void decodeFileRef.current(file);
    };

    document.addEventListener('paste', handlePaste);

    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  return { decoded, error, decodeFile };
};
