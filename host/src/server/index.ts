import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { isValidAimPrefix } from '../shared/aim.js';
import { buildScanReports, toHex, type Fault, type FramingOptions } from '../shared/framing.js';
import { getPreset } from '../shared/presets.js';
import {
  DEFAULT_PROFILE_ID,
  DEVICE_PROFILES,
  getDeviceProfile,
  toServiceProfile,
  toWireReport,
  type DeviceProfile,
  type DeviceProfileId,
} from '../shared/profiles.js';
import { openAppWindow } from './appWindow.js';
import { INDEX_HTML_PATH, PUBLIC_DIR, ZXING_UMD_PATH } from './paths.js';
import { ServiceClient } from './serviceClient.js';
import { EmulatorState } from './state.js';
import type { EmulatorToUiMessage, ScanRequest, UiToEmulatorMessage } from '../shared/uiProtocol.js';

const DEFAULT_PORT = 7411;
const DEFAULT_DELAY_MS = 5;
const MAX_DELAY_MS = 1000;
const MAX_REQUEST_BYTES = 64 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const parsePort = (argv: Array<string>): number => {
  const inlineArgument = argv.find((argument) => argument.startsWith('--port='));
  const flagIndex = argv.indexOf('--port');
  const rawPort =
    typeof inlineArgument === 'string'
      ? inlineArgument.slice('--port='.length)
      : argv[flagIndex + 1];
  const port = Number(rawPort);

  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
};

const port = parsePort(process.argv.slice(2));
const shouldOpen = process.argv.includes('--open');
const state = new EmulatorState(port);
const service = new ServiceClient();
const uiSockets = new Set<WebSocket>();

const broadcastState = (): void => {
  const message: EmulatorToUiMessage = { type: 'ui-state', state: state.getSnapshot() };
  const payload = JSON.stringify(message);

  uiSockets.forEach((socket) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  });
};

const resolveProfile = (profileId?: string): DeviceProfile => {
  if (typeof profileId === 'string' && profileId.length > 0) {
    return getDeviceProfile(profileId);
  }

  const pluggedDevices = state.getPluggedDevices();
  const singleDevice = pluggedDevices.length === 1 ? pluggedDevices[0] : undefined;

  return getDeviceProfile(singleDevice?.profileId ?? DEFAULT_PROFILE_ID);
};

const resolveScanText = (request: ScanRequest): string => {
  if (typeof request.presetId === 'string' && request.presetId !== 'custom') {
    return getPreset(request.presetId).text;
  }

  return request.text ?? '';
};

/** The service takes one hex string per wire report, so the report id byte is prepended here. */
const toWireHex = (profile: DeviceProfile, report: Uint8Array): string =>
  Array.from(toWireReport(profile, report))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const runScan = async (request: ScanRequest): Promise<number> => {
  const profile = resolveProfile(request.profileId);
  const text = resolveScanText(request);

  if (text.length === 0) {
    throw new Error('Nothing to scan: provide "text" or a "presetId"');
  }

  const options = request.options ?? {};

  if (typeof options.aimPrefix === 'string' && !isValidAimPrefix(options.aimPrefix)) {
    throw new Error(`Invalid AIM prefix: ${options.aimPrefix}`);
  }

  const faults = new Set<Fault>(options.faults ?? []);
  const delayMs = Math.min(Math.max(options.delayMs ?? DEFAULT_DELAY_MS, 0), MAX_DELAY_MS);
  const framingOptions: FramingOptions = {
    aimPrefix: options.aimPrefix ?? null,
    terminator: options.terminator ?? 'CR',
    faults,
  };
  const reports = buildScanReports(text, profile, framingOptions);
  const faultSummary = faults.size > 0 ? ` · faults: ${Array.from(faults).join(', ')}` : '';
  const sourceSummary =
    typeof request.source !== 'undefined'
      ? `from image ${request.source.fileName} (${request.source.format}) · `
      : '';

  state.appendLog(
    'toApp',
    `scan ${sourceSummary}${reports.length} report(s) · ${profile.id} · terminator ${framingOptions.terminator}${faultSummary}`,
    text,
  );

  reports.forEach((report, index) => {
    state.appendLog('toApp', `report ${index + 1}/${reports.length} · ${profile.id}`, toHex(report));
  });

  return await service.emitReports(
    profile.id,
    reports.map((report) => toWireHex(profile, report)),
    delayMs,
  );
};

/**
 * Takes the device list from the service, which is the only place that knows it. The service
 * outlives the host, so restarting `yarn start` with a device still plugged in must show that
 * device instead of an empty list and an `already plugged` error on the next click.
 */
const reconcileDevices = async (): Promise<void> => {
  const devices = await service.list();

  devices.forEach((device) => {
    const profile = DEVICE_PROFILES[device.instanceId as DeviceProfileId];

    if (typeof profile === 'undefined') {
      state.appendLog('system', `service has an unknown device ${device.instanceId}`);
      return;
    }

    state.plugDevice(profile, device.devicePath);
    state.setReaderActive(profile.id, device.readerActive);
  });
};

const plugDevice = async (profileId: string): Promise<void> => {
  await service.plug(toServiceProfile(getDeviceProfile(profileId)));
  await reconcileDevices();
};

const unplugDevice = async (profileId: string): Promise<void> => {
  const profile = getDeviceProfile(profileId);

  await service.unplug(profile.id);
  state.unplugDevice(profile.id);
};

const sendToUi = (socket: WebSocket, message: EmulatorToUiMessage): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const handleUiMessage = async (socket: WebSocket, message: UiToEmulatorMessage): Promise<void> => {
  switch (message.type) {
    case 'ui-plug':
      await plugDevice(message.profileId);
      break;
    case 'ui-unplug':
      await unplugDevice(message.profileId);
      break;
    case 'ui-scan': {
      const reportCount = await runScan(message);

      sendToUi(socket, { type: 'ui-scan-result', reportCount });
      break;
    }
    case 'ui-clear-log':
      state.clearLog();
      break;
    default:
      break;
  }
};

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Array<Buffer> = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > MAX_REQUEST_BYTES) {
      throw new Error('Request body is too large');
    }

    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const sendFile = async (
  response: ServerResponse,
  filePath: string,
  contentType: string,
): Promise<boolean> => {
  try {
    const file = await readFile(filePath);

    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(file);

    return true;
  } catch {
    return false;
  }
};

/** Serves files from `public/` only; anything that escapes the directory is a 404. */
const sendPublicFile = async (response: ServerResponse, pathname: string): Promise<boolean> => {
  const filePath = join(PUBLIC_DIR, normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ''));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  return await sendFile(response, filePath, CONTENT_TYPES[extname(filePath)] ?? 'text/plain');
};

const handleHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    await sendFile(response, INDEX_HTML_PATH, CONTENT_TYPES['.html'] as string);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/vendor/zxing.js') {
    const wasSent = await sendFile(response, ZXING_UMD_PATH, CONTENT_TYPES['.js'] as string);

    if (!wasSent) {
      sendJson(response, 404, { error: '@zxing/library UMD build is missing, run yarn install' });
    }

    return;
  }

  if (request.method === 'GET' && url.pathname === '/state') {
    sendJson(response, 200, state.getSnapshot());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/scan') {
    const body = await readRequestBody(request);
    const scanRequest = (body.length > 0 ? JSON.parse(body) : {}) as ScanRequest;
    const reportCount = await runScan(scanRequest);

    sendJson(response, 202, { status: 'accepted', reportCount });
    return;
  }

  if (request.method === 'GET' && (await sendPublicFile(response, url.pathname))) {
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
};

const httpServer = createServer((request, response) => {
  handleHttpRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    state.appendLog('system', `http error: ${message}`);
    sendJson(response, 400, { error: message });
  });
});

const webSocketServer = new WebSocketServer({ server: httpServer });

// ws re-emits the HTTP server's errors, such as a port in use, on itself. The HTTP server's own
// listener below handles them; without this one the re-emitted copy would crash the process first.
webSocketServer.on('error', () => undefined);

webSocketServer.on('connection', (socket: WebSocket) => {
  socket.on('message', (raw: Buffer) => {
    const message = JSON.parse(raw.toString('utf8')) as UiToEmulatorMessage;

    if (message.type === 'ui-hello') {
      uiSockets.add(socket);
      broadcastState();
      return;
    }

    handleUiMessage(socket, message).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);

      state.appendLog('system', `message error: ${text}`);
      sendToUi(socket, { type: 'ui-error', message: text });
    });
  });

  // Without this listener a protocol-level failure (a malformed frame, invalid UTF-8, an oversized
  // payload) emits 'error' with nothing attached, and Node kills the process. `close` still fires
  // after it, so the socket is cleaned up there.
  socket.on('error', (error: Error) => {
    state.appendLog('system', `socket error: ${error.message}`);
  });

  socket.on('close', () => {
    uiSockets.delete(socket);
  });
});

service.on('connected', () => {
  state.appendLog('system', 'connected to HidPosEmuSvc');
});

service.on('hello', (hello) => {
  state.setServiceStatus({ connected: true, driverInstalled: hello.driverInstalled });
  state.appendLog(
    'system',
    `HidPosEmuSvc ${hello.version}, driver ${hello.driverInstalled ? 'installed' : 'missing'}`,
  );

  reconcileDevices().catch((error: unknown) => {
    state.appendLog('system', `cannot list devices: ${String(error)}`);
  });
});

service.on('device', (event) => {
  if (event.state === 'reader') {
    state.setReaderActive(event.device.instanceId, event.device.readerActive);
    return;
  }

  state.appendLog('system', `service reports ${event.device.instanceId} ${event.state}`);
});

service.on('disconnected', () => {
  state.setServiceStatus({ connected: false, driverInstalled: false });
  state.appendLog('system', 'HidPosEmuSvc disconnected, retrying every 2 s');
});

// Connecting to a pipe that is not there (service stopped, or a non-Windows machine) is the normal
// state before install.ps1 has run; the UI shows it and the client keeps retrying.
service.on('error', () => undefined);

state.onChange(broadcastState);
service.start();

const url = `http://localhost:${port}`;

// A port in use is most likely the emulator itself, started earlier. With --open the user only
// wants its window, so opening that is success, not an error.
httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') {
    throw error;
  }

  if (shouldOpen) {
    process.stdout.write(`Port ${port} is already in use, opening ${url}\n`);
    openAppWindow(url);
    process.exit(0);
  }

  process.stderr.write(`Port ${port} is already in use: the emulator may be running already, or pass --port\n`);
  process.exit(1);
});

httpServer.listen(port, '127.0.0.1', () => {
  process.stdout.write(`HID-POS emulator on ${url}\n`);

  if (shouldOpen) {
    process.stdout.write('Close this window to stop the emulator\n');
    openAppWindow(url);
  }
});
