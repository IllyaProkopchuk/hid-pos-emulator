import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';

import type { ServiceProfile } from '../shared/profiles.js';

/**
 * Transport to `HidPosEmuSvc`. The service owns `SwDeviceCreate` and the HID handle, this side only
 * speaks the JSON-lines protocol over the named pipe.
 */

export const DEFAULT_PIPE_PATH = '\\\\.\\pipe\\HidPosEmu';

const REQUEST_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 2000;

export type ServiceClientOptions = {
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
};

export type ServiceDevice = {
  instanceId: string;
  devicePath: string;
  readerActive: boolean;
};

export type ServiceRequest =
  | { id: number; op: 'list' }
  | { id: number; op: 'plug'; profile: ServiceProfile }
  | { id: number; op: 'unplug'; instanceId: string }
  | { id: number; op: 'emit'; instanceId: string; reportsHex: Array<string>; delayMs: number };

export type ServiceResponse =
  | { id: number; ok: true; devices?: Array<ServiceDevice>; reportCount?: number }
  | { id: number; ok: false; error: string; win32?: number };

export type ServiceEvent =
  | { event: 'hello'; version: string; driverInstalled: boolean }
  | { event: 'device'; device: ServiceDevice; state: 'plugged' | 'unplugged' | 'reader' };

export type ServiceMessage = ServiceResponse | ServiceEvent;

export type ServiceClientEvents = {
  hello: [Extract<ServiceEvent, { event: 'hello' }>];
  device: [Extract<ServiceEvent, { event: 'device' }>];
  connected: [];
  disconnected: [];
  error: [Error];
};

/**
 * Splits a byte stream into complete JSON lines. A chunk may end mid-line and may hold several
 * objects, so the tail is carried over to the next chunk.
 */
export class JsonLineDecoder {
  private buffer = '';

  public push(chunk: string): Array<ServiceMessage> {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');

    this.buffer = lines.pop() ?? '';

    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ServiceMessage);
  }

  public reset(): void {
    this.buffer = '';
  }
}

export const encodeRequest = (request: ServiceRequest): string => `${JSON.stringify(request)}\n`;

const isResponse = (message: ServiceMessage): message is ServiceResponse =>
  typeof (message as ServiceResponse).id === 'number';

type PendingRequest = {
  resolve: (response: ServiceResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class ServiceClient extends EventEmitter<ServiceClientEvents> {
  private socket: Socket | null = null;

  private readonly decoder = new JsonLineDecoder();

  private readonly pending = new Map<number, PendingRequest>();

  private reconnectTimer: NodeJS.Timeout | null = null;

  private isStopped = false;

  private requestSequence = 0;

  private connected = false;

  private driverInstalled = false;

  private serviceVersion: string | null = null;

  private readonly requestTimeoutMs: number;

  private readonly reconnectDelayMs: number;

  public constructor(
    private readonly pipePath: string = DEFAULT_PIPE_PATH,
    options: ServiceClientOptions = {},
  ) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  }

  public start(): void {
    this.isStopped = false;
    this.openSocket();
  }

  public stop(): void {
    this.isStopped = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.destroy();
    this.socket = null;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public isDriverInstalled(): boolean {
    return this.driverInstalled;
  }

  public getVersion(): string | null {
    return this.serviceVersion;
  }

  public async list(): Promise<Array<ServiceDevice>> {
    const response = await this.request((id) => ({ id, op: 'list' }));

    return response.devices ?? [];
  }

  public async plug(profile: ServiceProfile): Promise<void> {
    await this.request((id) => ({ id, op: 'plug', profile }));
  }

  public async unplug(instanceId: string): Promise<void> {
    await this.request((id) => ({ id, op: 'unplug', instanceId }));
  }

  public async emitReports(
    instanceId: string,
    reportsHex: Array<string>,
    delayMs: number,
  ): Promise<number> {
    const response = await this.request((id) => ({
      id,
      op: 'emit',
      instanceId,
      reportsHex,
      delayMs,
    }));

    return response.reportCount ?? reportsHex.length;
  }

  /** Resolves only on `ok: true`; a service-side failure rejects with the service's own message. */
  private async request(
    build: (id: number) => ServiceRequest,
  ): Promise<Extract<ServiceResponse, { ok: true }>> {
    const socket = this.socket;

    if (socket === null || !this.connected) {
      throw new Error('HidPosEmuSvc is not connected');
    }

    this.requestSequence += 1;

    const id = this.requestSequence;
    const request = build(id);
    const response = await new Promise<ServiceResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `HidPosEmuSvc did not answer ${request.op} within ${this.requestTimeoutMs} ms`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      socket.write(encodeRequest(request));
    });

    if (!response.ok) {
      const suffix = typeof response.win32 === 'number' ? ` (win32 ${response.win32})` : '';

      throw new Error(`${response.error}${suffix}`);
    }

    return response;
  }

  private openSocket(): void {
    this.decoder.reset();

    const socket = connect(this.pipePath);

    this.socket = socket;
    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.connected = true;
      this.emit('connected');
    });

    socket.on('data', (chunk: string) => {
      this.handleChunk(chunk);
    });

    socket.on('error', (error: Error) => {
      this.reportError(error);
    });

    socket.on('close', () => {
      this.handleClose();
    });
  }

  private handleChunk(chunk: string): void {
    let messages: Array<ServiceMessage>;

    try {
      messages = this.decoder.push(chunk);
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    messages.forEach((message) => this.handleMessage(message));
  }

  private handleMessage(message: ServiceMessage): void {
    if (isResponse(message)) {
      const pending = this.pending.get(message.id);

      if (typeof pending === 'undefined') {
        return;
      }

      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);

      return;
    }

    if (message.event === 'hello') {
      this.driverInstalled = message.driverInstalled;
      this.serviceVersion = message.version;
      this.emit('hello', message);

      return;
    }

    this.emit('device', message);
  }

  /**
   * A missing pipe (the service is not running, or this is not Windows) arrives here and is the
   * normal state until install.ps1 has run. An unheard `error` event would take the process down,
   * so it is only emitted when somebody is listening.
   */
  private reportError(error: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
  }

  private handleClose(): void {
    const wasConnected = this.connected;

    this.connected = false;
    this.driverInstalled = false;
    this.serviceVersion = null;
    this.socket = null;

    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('HidPosEmuSvc connection closed'));
    });
    this.pending.clear();

    if (wasConnected) {
      this.emit('disconnected');
    }

    if (this.isStopped) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref();
  }
}
