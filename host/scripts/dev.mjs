// Development mode in one command: rebuilds the page on every save in src/ui/ and restarts the
// server on every save in src/server/ or src/shared/. There is no hot reload: refresh the browser.
// Arguments are passed to the server, so `yarn dev --port 7500` works like `yarn start`.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { context } from 'esbuild';

const require = createRequire(import.meta.url);

// The same options as the watch:ui script in package.json.
const ui = await context({
  entryPoints: ['src/ui/index.tsx'],
  bundle: true,
  sourcemap: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/build/app.js',
  logLevel: 'info',
});

await ui.watch();

// The first build has to finish before the server starts, or the page 404s on /build/app.js.
await ui.rebuild();

const server = spawn(
  process.execPath,
  [require.resolve('tsx/cli'), 'watch', '--clear-screen=false', 'src/server/index.ts', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

const stop = async (code) => {
  await ui.dispose();
  process.exit(code);
};

server.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => server.kill('SIGINT'));
