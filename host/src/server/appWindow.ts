import { spawn } from 'node:child_process';

/**
 * Opens the page as an Edge app window: its own taskbar entry, no tabs and no address bar, so the
 * emulator looks like a program rather than a browser tab. Used by the release's `HidPosEmu.cmd`
 * through `--open`.
 *
 * Edge rather than the default browser because only Chromium has `--app`, and Edge is the one
 * Chromium every Windows 11 machine has. `start` finds it through App Paths, so no install path is
 * hardcoded. Elsewhere, which only CI is, it prints the address instead.
 */
export const openAppWindow = (url: string): void => {
  if (process.platform !== 'win32') {
    process.stdout.write(`Open ${url} in a browser\n`);
    return;
  }

  // Verbatim, because Node would otherwise escape the empty window title that `start` needs.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" msedge --app=${url}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });

  child.on('error', () => process.stdout.write(`Open ${url} in a browser\n`));
  child.unref();
};
