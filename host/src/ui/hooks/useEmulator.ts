import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  EmulatorStateSnapshot,
  EmulatorToUiMessage,
  UiToEmulatorMessage,
} from '@shared/uiProtocol';

import { FEEDBACK_TIMEOUT_MS, RECONNECT_DELAY_MS } from '@/constants/scan';

/**
 * The WebSocket to the host, which is independent of whether the host can reach the service.
 * `connecting` only ever describes the first attempt; after a drop the page reports `offline` while
 * it retries.
 */
export type Connection = 'connecting' | 'online' | 'offline';

export type Emulator = {
  /** `null` until the host has sent its first snapshot. */
  state: EmulatorStateSnapshot | null;
  connection: Connection;
  /** The last scan result or error, cleared a few seconds after it arrives. */
  feedback: string;
  send: (message: UiToEmulatorMessage) => void;
};

/**
 * The page's one connection to the host. The host pushes a complete snapshot on every change, so
 * there is no client side state to reconcile: whatever arrived last is the truth.
 */
export const useEmulator = (): Emulator => {
  const socketRef = useRef<WebSocket | null>(null);
  const feedbackTimeoutRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<EmulatorStateSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [feedback, setFeedback] = useState('');

  const send = useCallback((message: UiToEmulatorMessage) => {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    let reconnectTimeoutId: number | undefined;
    let isDisposed = false;

    const showFeedback = (message: string) => {
      setFeedback(message);
      window.clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(''), FEEDBACK_TIMEOUT_MS);
    };

    const connect = () => {
      const socket = new WebSocket('ws://' + window.location.host);

      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setConnection('online');
        socket.send(JSON.stringify({ type: 'ui-hello' } satisfies UiToEmulatorMessage));
      });

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as EmulatorToUiMessage;

        switch (message.type) {
          case 'ui-state':
            setState(message.state);
            break;
          case 'ui-scan-result':
            showFeedback(
              'Sent ' + message.reportCount + (message.reportCount === 1 ? ' report' : ' reports'),
            );
            break;
          case 'ui-error':
            showFeedback(message.message);
            break;
        }
      });

      socket.addEventListener('close', () => {
        // A socket replaced by a newer one, or closed on unmount, has nothing left to report.
        if (isDisposed || socketRef.current !== socket) {
          return;
        }

        setConnection('offline');
        reconnectTimeoutId = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    connect();

    return () => {
      isDisposed = true;
      window.clearTimeout(reconnectTimeoutId);
      window.clearTimeout(feedbackTimeoutRef.current);
      socketRef.current?.close();
    };
  }, []);

  return { state, connection, feedback, send };
};
