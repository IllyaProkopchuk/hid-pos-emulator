import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The host directory: the one that holds `public/index.html`.
 *
 * Found by walking up from this module rather than by a fixed number of `..`, because this code runs
 * from two places at different depths: `src/server/` in a checkout, and the single bundled file in
 * `host\bin\` of a release. A fixed relative path could only ever be right for one of them.
 */
const findHostRoot = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    if (existsSync(join(directory, 'public', 'index.html'))) {
      return directory;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error('Cannot find public/index.html above ' + fileURLToPath(import.meta.url));
    }

    directory = parent;
  }
};

export const HOST_ROOT = findHostRoot();

/** Ends with a separator, so a prefix check cannot mistake `public-other` for `public`. */
export const PUBLIC_DIR = join(HOST_ROOT, 'public') + sep;

export const INDEX_HTML_PATH = join(PUBLIC_DIR, 'index.html');

export const ZXING_UMD_PATH = join(
  HOST_ROOT,
  'node_modules',
  '@zxing',
  'library',
  'umd',
  'index.min.js',
);
