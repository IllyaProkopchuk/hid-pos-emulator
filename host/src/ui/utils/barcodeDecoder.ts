/**
 * Decodes barcodes from an image file. Native `BarcodeDetector` is preferred because it returns
 * every code on the picture at once; ZXing is the fallback and returns one code per image.
 *
 * ZXing is not bundled: the host serves its UMD build at `/vendor/zxing.js`, and it is only loaded
 * the first time a photo needs it.
 */

export type DecodedCode = {
  text: string;
  format: string;
};

const MAX_DIMENSION = 2000;
const ZXING_URL = '/vendor/zxing.js';

/** The slice of the ZXing UMD global this module uses. */
type ZxingGlobal = {
  MultiFormatReader: new () => {
    setHints: (hints: Map<unknown, unknown>) => void;
    decode: (bitmap: unknown) => { getText: () => string; getBarcodeFormat: () => number };
    reset: () => void;
  };
  BinaryBitmap: new (binarizer: unknown) => unknown;
  HybridBinarizer: new (source: unknown) => unknown;
  HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => unknown;
  DecodeHintType: { TRY_HARDER: unknown };
  BarcodeFormat: Record<number, string>;
};

type DetectedBarcode = { rawValue: string; format: string };

type BarcodeDetectorConstructor = new () => {
  detect: (source: HTMLCanvasElement) => Promise<Array<DetectedBarcode>>;
};

declare global {
  interface Window {
    ZXing?: ZxingGlobal;
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

let zxingPromise: Promise<ZxingGlobal> | null = null;

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('The file could not be read as an image'));
    });
    image.src = url;
  });

const toCanvas = (image: HTMLImageElement): HTMLCanvasElement => {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas;
};

const normalizeFormat = (format: unknown): string =>
  String(format).toLowerCase().replace('pdf_417', 'pdf417');

const detectWithBarcodeDetector = async (
  Detector: BarcodeDetectorConstructor,
  canvas: HTMLCanvasElement,
): Promise<Array<DecodedCode>> => {
  const codes = await new Detector().detect(canvas);

  return codes.map((code) => ({ text: code.rawValue, format: normalizeFormat(code.format) }));
};

const loadZxing = (): Promise<ZxingGlobal> => {
  if (zxingPromise === null) {
    zxingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = ZXING_URL;
      script.addEventListener('load', () => {
        if (window.ZXing) {
          resolve(window.ZXing);
        } else {
          reject(new Error('ZXing loaded but did not define window.ZXing'));
        }
      });
      script.addEventListener('error', () =>
        reject(new Error('ZXing could not be loaded from ' + ZXING_URL)),
      );
      document.head.appendChild(script);
    });
  }

  return zxingPromise;
};

const detectWithZxing = async (canvas: HTMLCanvasElement): Promise<Array<DecodedCode>> => {
  const zxing = await loadZxing();
  const reader = new zxing.MultiFormatReader();
  const bitmap = new zxing.BinaryBitmap(
    new zxing.HybridBinarizer(new zxing.HTMLCanvasElementLuminanceSource(canvas)),
  );

  reader.setHints(new Map([[zxing.DecodeHintType.TRY_HARDER, true]]));

  try {
    const result = reader.decode(bitmap);

    return [
      {
        text: result.getText(),
        format: normalizeFormat(zxing.BarcodeFormat[result.getBarcodeFormat()]),
      },
    ];
  } catch {
    return [];
  } finally {
    reader.reset();
  }
};

export const decodeImageFile = async (file: File): Promise<Array<DecodedCode>> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Unsupported file type');
  }

  const canvas = toCanvas(await loadImage(file));
  const Detector = window.BarcodeDetector;

  if (Detector) {
    try {
      return await detectWithBarcodeDetector(Detector, canvas);
    } catch (error) {
      // Some Chromium builds (notably Linux) expose the constructor but have no barcode backend,
      // so `detect()` rejects. That is precisely the case ZXing is bundled for.
      console.warn('[hid-pos-emulator] BarcodeDetector failed, falling back to ZXing', error);
    }
  }

  return await detectWithZxing(canvas);
};
