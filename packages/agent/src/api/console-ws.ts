import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  consoleClientMessageSchema,
  type ConsoleServerMessage,
  type Permission,
} from '@mojito/contract';
import type { AgentConfig } from '../config';
import type { ProcessRegistry } from '../process/registry';
import { toPanelStatus } from '../process/states';
import { verifyConsoleToken, hasConsolePermission } from './jwt';

/**
 * Browser-facing console WebSocket (Pelican-style direct user ↔ agent socket).
 *
 * Auth: console JWT in the query string (browsers cannot set WS headers),
 * verified at connection (signature, aud, exp, serverId) — then EVERY
 * incoming message is re-gated on the permissions carried by the payload.
 * The panel token does NOT apply here: the hook in api/index.ts skips this route.
 */

const WS_CLOSE_UNAUTHORIZED = 4001;
const WS_CLOSE_FORBIDDEN = 4003;
const COMMAND_LIMIT_PER_SECOND = 10;

const POWER_PERMISSIONS: Record<'start' | 'stop' | 'restart' | 'kill', Permission> = {
  start: 'power.start',
  stop: 'power.stop',
  restart: 'power.restart',
  kill: 'power.kill',
};

export interface ConsoleWsOptions {
  config: AgentConfig;
  registry: ProcessRegistry;
}

function registerConsoleWs(app: FastifyInstance, options: ConsoleWsOptions): void {
  const { config, registry } = options;

  app.get<{ Params: { serverId: string }; Querystring: { token?: string } }>(
    '/servers/:serverId/ws',
    { websocket: true },
    (socket, request) => {
      handleConsoleSocket(socket, request.params.serverId, request.query.token);
    },
  );

  function handleConsoleSocket(socket: WebSocket, serverId: string, token: string | undefined): void {
    let closed = false;
    let unsubscribe: (() => void) | null = null;

    const send = (message: ConsoleServerMessage): void => {
      if (!closed) socket.send(JSON.stringify(message));
    };
    const closeWith = (code: number): void => {
      if (!closed) {
        closed = true;
        socket.close(code);
      }
    };
    const sendStatus = (): void => {
      send({ type: 'status', status: toPanelStatus(registry.getState(serverId), false) });
    };

    socket.on('close', () => {
      closed = true;
      unsubscribe?.();
    });

    // ─── Handshake: verify the console JWT ───────────────────────────────
    if (!token) {
      closeWith(WS_CLOSE_UNAUTHORIZED);
      return;
    }
    let payload;
    try {
      payload = verifyConsoleToken(token, config.jwtSecret, { serverId });
    } catch {
      // No distinction between invalid/expired client-side — do not leak details.
      closeWith(WS_CLOSE_UNAUTHORIZED);
      return;
    }
    // Reading the stream is itself gated on console.read.
    if (!hasConsolePermission(payload, 'console.read')) {
      closeWith(WS_CLOSE_FORBIDDEN);
      return;
    }

    // ─── Authenticated: initial batch + live subscription ────────────────
    send({ type: 'auth-ok' });
    send({ type: 'log', lines: registry.getLogs(serverId) });
    sendStatus();

    let commandTimestamps: number[] = [];

    unsubscribe = registry.subscribe(serverId, {
      onLog: (line) => send({ type: 'log', lines: [line] }),
      onState: () => sendStatus(),
    });

    // ─── Incoming messages: permissions re-checked EVERY time ────────────
    socket.on('message', (data) => {
      if (closed) return;

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        send({ type: 'error', code: 'invalid-message' });
        return;
      }
      const parsed = consoleClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        send({ type: 'error', code: 'invalid-message' });
        return;
      }

      if (parsed.data.type === 'command') {
        if (!hasConsolePermission(payload, 'console.write')) {
          send({ type: 'error', code: 'forbidden' });
          return;
        }
        // Basic anti-flood per socket (E7)
        const now = Date.now();
        commandTimestamps = commandTimestamps.filter((t) => now - t < 1000);
        if (commandTimestamps.length >= COMMAND_LIMIT_PER_SECOND) {
          send({ type: 'error', code: 'rate-limited' });
          return;
        }
        commandTimestamps.push(now);

        void registry
          .sendCommand(serverId, parsed.data.command)
          .then((sent) => {
            // Not running → the status update tells the console why nothing happened
            if (!sent) sendStatus();
          })
          .catch(() => sendStatus());
        return;
      }

      const permission = POWER_PERMISSIONS[parsed.data.action];
      if (!hasConsolePermission(payload, permission)) {
        send({ type: 'error', code: 'forbidden' });
        return;
      }
      void registry
        .handlePowerAction(serverId, parsed.data.action)
        .then(() => sendStatus())
        .catch(() => sendStatus());
    });
  }
}

export { registerConsoleWs };
