import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';

import { JsonLineDecoder, ServiceClient } from '../src/server/serviceClient.js';
import type { ServiceRequest } from '../src/server/serviceClient.js';

/**
 * The real transport is a Windows named pipe. `net` addresses one by path just like a unix socket,
 * so the client is exercised unchanged either way, but the two cannot share an address: Windows
 * refuses to listen on a filesystem path and only accepts `\\.\pipe\...`.
 *
 * The socket branch is not portability for its own sake. CI runs this suite on Linux, because that
 * is the only part of the product that builds anywhere but Windows, so both branches have to work.
 */
type FakeService = {
  client: ServiceClient;
  close: () => Promise<void>;
};

let pipeOrdinal = 0;

const createAddress = async (): Promise<{ path: string; cleanup: () => Promise<void> }> => {
  if (process.platform === 'win32') {
    // Named pipes live in their own namespace and disappear with the server, so nothing to remove.
    return {
      path: `\\\\.\\pipe\\hidposemu-test-${process.pid}-${(pipeOrdinal += 1)}`,
      cleanup: async () => undefined,
    };
  }

  const directory = await mkdtemp(join(tmpdir(), 'hidposemu-'));

  return {
    path: join(directory, 'pipe.sock'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

const startFakeService = async (
  onRequest: (request: ServiceRequest, socket: Socket) => void,
): Promise<FakeService> => {
  const address = await createAddress();
  const server: Server = createServer((socket) => {
    const decoder = new JsonLineDecoder();

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      decoder
        .push(chunk)
        .forEach((message) => onRequest(message as unknown as ServiceRequest, socket));
    });
    socket.on('error', () => undefined);
  });

  server.listen(address.path);
  await once(server, 'listening');

  const client = new ServiceClient(address.path, { requestTimeoutMs: 200, reconnectDelayMs: 50 });

  client.on('error', () => undefined);
  client.start();
  await once(client, 'connected');

  return {
    client,
    close: async () => {
      client.stop();
      server.close();
      await address.cleanup();
    },
  };
};

test('the codec keeps a partial line until the rest of it arrives', () => {
  const decoder = new JsonLineDecoder();

  assert.deepEqual(decoder.push('{"id":1,"ok":tr'), []);
  assert.deepEqual(decoder.push('ue,"reportCount":2}\n'), [{ id: 1, ok: true, reportCount: 2 }]);
});

test('the codec returns every object of a chunk that holds several', () => {
  const decoder = new JsonLineDecoder();
  const messages = decoder.push(
    '{"event":"hello","version":"1.0.0","driverInstalled":true}\n{"id":7,"ok":true}\n{"id":8',
  );

  assert.deepEqual(messages, [
    { event: 'hello', version: '1.0.0', driverInstalled: true },
    { id: 7, ok: true },
  ]);
  assert.deepEqual(decoder.push(',"ok":false,"error":"not plugged"}\n'), [
    { id: 8, ok: false, error: 'not plugged' },
  ]);
});

test('answers are correlated by id even when the service replies out of order', async () => {
  const pendingSockets: Array<{ request: ServiceRequest; socket: Socket }> = [];
  const service = await startFakeService((request, socket) => {
    pendingSockets.push({ request, socket });

    if (pendingSockets.length < 2) {
      return;
    }

    // Answer the second request first; the client must still hand each answer to its own caller.
    pendingSockets.reverse().forEach((entry) => {
      const reportCount = entry.request.op === 'emit' ? entry.request.reportsHex.length : 0;

      entry.socket.write(`${JSON.stringify({ id: entry.request.id, ok: true, reportCount })}\n`);
    });
  });

  const [first, second] = await Promise.all([
    service.client.emitReports('newland', ['02'], 0),
    service.client.emitReports('generic', ['02', '03', '04'], 0),
  ]);

  assert.equal(first, 1);
  assert.equal(second, 3);

  await service.close();
});

test('a request the service never answers rejects after the timeout', async () => {
  const service = await startFakeService(() => undefined);

  await assert.rejects(
    async () => await service.client.list(),
    /did not answer list within 200 ms/,
  );

  await service.close();
});
