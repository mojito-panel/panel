import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  consoleClientMessageSchema,
  type ConsoleServerMessage,
  type ConsoleTokenPayload,
  type Permission,
} from '@mojito/contract';
import type { AgentConfig } from '../../config';
import type { ServerManager } from '../../server/manager';
import type { InstallRegistry } from '../../server/installer/registry';
import { toPanelStatus } from '../../environment/states';
import { verifyConsoleToken, CLOCK_SKEW_SECONDS } from '../tokens/parser';
import { hasConsolePermission } from '../tokens/websocket';
import { makeOriginGate } from './origin';

/**
 * Browser-facing console WebSocket (Pelican-style direct user ↔ agent socket).
 * Streams BOTH the runtime logs and the install (steps + logs) — installs use
 * the same socket instead of a panel polling loop.
 *
 * Auth (aligned with wings, router/websocket/websocket.go):
 * - the socket opens UNauthenticated — the Origin header must match the panel
 *   (or AGENT_ALLOWED_ORIGINS) before the upgrade;
 * - the console JWT travels as the FIRST `auth` message, never in the URL;
 * - the JWT is signed by the panel with the node's agent token — the agent
 *   verifies it with its own token (single per-node secret, no separate key);
 * - EVERY incoming message re-checks expiry and the permissions carried by
 *   the payload; re-sending `auth` refreshes the token without reconnecting.
 * The panel token does NOT apply here: the hook in api/index.ts skips this route.
 */

const WS_CLOSE_UNAUTHORIZED = 4001;
const WS_CLOSE_FORBIDDEN = 4003;
const COMMAND_LIMIT_PER_SECOND = 10;
/** No `auth` message within this window → close (wings does the same). */
const AUTH_TIMEOUT_MS = 10_000;

const POWER_PERMISSIONS: Record<'start' | 'stop' | 'restart' | 'kill', Permission> = {
  start: 'power.start',
  stop: 'power.stop',
  restart: 'power.restart',
  kill: 'power.kill',
};

export interface ConsoleWsOptions {
  config: AgentConfig;
  manager: ServerManager;
  /** Install states — the install (steps + logs) streams over the SAME socket. */
  registry: InstallRegistry;
}

function registerConsoleWs(app: FastifyInstance, options: ConsoleWsOptions): void {
  // Origin gate — shared with the health WS (see websocket/origin.ts)
  const checkOrigin = makeOriginGate(options.config);

  app.get<{ Params: { serverId: string } }>(
    '/servers/:serverId/ws',
    { websocket: true, preHandler: checkOrigin },
    (socket, request) => {
      handleConsoleSocket(socket, request.params.serverId);
    },
  );

  function handleConsoleSocket(socket: WebSocket, serverId: string): void {
    const { manager, registry } = options;
    let closed = false;
    let payload: ConsoleTokenPayload | null = null;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeInstall: (() => void) | null = null;

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
      send({ type: 'status', status: toPanelStatus(manager.getState(serverId), false) });
    };
    /** install-status snapshot (banner: step, percent, error). */
    const sendInstallStatus = (): void => {
      const state = registry.get(serverId);
      if (!state) return;
      send({
        type: 'install-status',
        status: state.status,
        step: state.step,
        totalSteps: state.totalSteps,
        percent: state.percent,
        message: state.message,
        error: state.error,
      });
    };
    /** Full install trail replay (new install or fresh connection). */
    const sendInstallReplay = (): void => {
      const state = registry.get(serverId);
      if (!state) return;
      sendInstallStatus();
      send({ type: 'install-log', lines: state.logs, reset: true, replace: false });
    };

    /** No `auth` message in time → close (wings does the same). */
    let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // A socket that never authenticates is useless
      closeWith(WS_CLOSE_UNAUTHORIZED);
    }, AUTH_TIMEOUT_MS);

    socket.on('close', () => {
      closed = true;
      if (authTimer) clearTimeout(authTimer);
      unsubscribe?.();
      unsubscribeInstall?.();
    });

    /** Full token check: signature, aud, scope, exp, serverId match. */
    const authenticate = (token: string): ConsoleTokenPayload | null => {
      try {
        return verifyConsoleToken(token, options.config.token, { serverId });
      } catch {
        return null; // no distinction invalid/expired client-side — do not leak details
      }
    };

    /** Expiry re-check for every message (wings TokenValid). */
    const payloadExpired = (): boolean =>
      payload !== null && payload.exp + CLOCK_SKEW_SECONDS < Math.floor(Date.now() / 1000);

    const onAuthSuccess = (freshPayload: ConsoleTokenPayload): void => {
      // Reading the stream is gated on console.read
      if (!hasConsolePermission(freshPayload, 'console.read')) {
        send({ type: 'error', code: 'forbidden' });
        closeWith(WS_CLOSE_FORBIDDEN);
        return;
      }
      payload = freshPayload;
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      if (unsubscribe) {
        // Token refresh on a live connection — acknowledge only, no duplicate
        // status/batch (like wings on a re-auth event)
        send({ type: 'auth-ok' });
        return;
      }
      send({ type: 'auth-ok' });
      send({ type: 'log', lines: manager.getLogs(serverId) });
      sendStatus();
      unsubscribe = manager.subscribe(serverId, {
        onLog: (line) => send({ type: 'log', lines: [line] }),
        onState: () => sendStatus(),
      });

      // ─── Install stream (same socket, same console.read permission) ────
      // A finished install is not replayed: only an ongoing or failed one
      // matters to the user opening the console.
      const install = registry.get(serverId);
      if (install && install.status !== 'installed') {
        sendInstallReplay();
      }
      unsubscribeInstall = registry.subscribe(serverId, (event) => {
        if (closed) return;
        if (event.kind === 'start') {
          sendInstallReplay();
          return;
        }
        if (event.kind === 'log') {
          send({
            type: 'install-log',
            lines: [event.line],
            reset: false,
            replace: event.replace,
          });
          return;
        }
        // update (step/percent) and the terminal status after finish
        sendInstallStatus();
      });
    };

    let commandTimestamps: number[] = [];

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

      // ─── Handshake / token refresh ────────────────────────────────────
      if (parsed.data.type === 'auth') {
        const freshPayload = authenticate(parsed.data.token);
        if (!freshPayload) {
          send({ type: 'error', code: 'unauthorized' });
          closeWith(WS_CLOSE_UNAUTHORIZED);
          return;
        }
        onAuthSuccess(freshPayload);
        return;
      }

      // ─── Authenticated actions: expiry + permissions re-checked EVERY time ──
      if (!payload) {
        send({ type: 'error', code: 'unauthorized' });
        return;
      }
      if (payloadExpired()) {
        // Expired mid-connection: the client can re-auth without reconnecting
        payload = null;
        send({ type: 'error', code: 'unauthorized' });
        return;
      }

      if (parsed.data.type === 'command') {
        if (!hasConsolePermission(payload, 'console.write')) {
          send({ type: 'error', code: 'forbidden' });
          return;
        }
        // Basic anti-flood per socket
        const now = Date.now();
        commandTimestamps = commandTimestamps.filter((t) => now - t < 1000);
        if (commandTimestamps.length >= COMMAND_LIMIT_PER_SECOND) {
          send({ type: 'error', code: 'rate-limited' });
          return;
        }
        commandTimestamps.push(now);

        void manager
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
      void manager
        .handlePowerAction(serverId, parsed.data.action)
        .then(() => sendStatus())
        .catch(() => sendStatus());
    });
  }
}

export { registerConsoleWs };
