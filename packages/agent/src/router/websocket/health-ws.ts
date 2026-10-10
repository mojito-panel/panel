import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  HEALTH_STATS_INTERVAL_MS,
  healthClientMessageSchema,
  type HealthServerMessage,
  type HealthTokenPayload,
} from '@mojito/contract';
import type { AgentConfig } from '../../config';
import type { SystemStatsCollector } from '../../system/stats';
import { verifyHealthToken, CLOCK_SKEW_SECONDS } from '../tokens/parser';
import { makeOriginGate } from './origin';

/**
 * Browser-facing node health WebSocket — Pelican-style DIRECT user ↔ agent
 * socket (the panel never relays stats, PR #2558 semantics: the graphs read
 * the live frames, the panel is not in the loop).
 *
 * Same auth model as the console WS:
 * - unauthenticated upgrade, gated on the Origin (panel);
 * - health JWT travels as the FIRST `auth` message (never in the URL);
 * - signed by the panel with the node's agent token — verified here against
 *   our own token; the panel token does NOT apply (hook exemption in middleware);
 * - re-sending `auth` refreshes the token without reconnecting.
 *
 * Once authenticated, the agent PUSHES a stats frame every STATS_INTERVAL_MS
 * until the token expires (then close 4001 → the client re-auths/reconnects).
 */

const WS_CLOSE_UNAUTHORIZED = 4001;
/** No `auth` message within this window → close (wings does the same). */
const AUTH_TIMEOUT_MS = 10_000;

export interface HealthWsOptions {
  config: AgentConfig;
  collector: SystemStatsCollector;
}

export function registerHealthWs(app: FastifyInstance, options: HealthWsOptions): void {
  const checkOrigin = makeOriginGate(options.config);

  app.get('/health/ws', { websocket: true, preHandler: checkOrigin }, (socket) => {
    handleHealthSocket(socket, options.collector, options.config.token);
  });
}

function handleHealthSocket(
  socket: WebSocket,
  collector: SystemStatsCollector,
  secret: string,
): void {
  let closed = false;
  let payload: HealthTokenPayload | null = null;
  let pushTimer: ReturnType<typeof setInterval> | null = null;

  const send = (message: HealthServerMessage): void => {
    if (!closed) socket.send(JSON.stringify(message));
  };
  const closeWith = (code: number): void => {
    if (!closed) {
      closed = true;
      socket.close(code);
    }
  };
  const stopPush = (): void => {
    if (pushTimer) {
      clearInterval(pushTimer);
      pushTimer = null;
    }
  };

  /** No `auth` message in time → close (wings does the same). */
  let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    closeWith(WS_CLOSE_UNAUTHORIZED);
  }, AUTH_TIMEOUT_MS);

  socket.on('close', () => {
    closed = true;
    if (authTimer) clearTimeout(authTimer);
    stopPush();
  });

  /** One stats frame — closes 4001 if the token expired (client re-auths). */
  const pushStats = async (): Promise<void> => {
    if (closed || !payload) return;
    if (payload.exp + CLOCK_SKEW_SECONDS < Math.floor(Date.now() / 1000)) {
      closeWith(WS_CLOSE_UNAUTHORIZED);
      return;
    }
    try {
      send({ type: 'stats', stats: await collector.sample() });
    } catch {
      // Sampling failure — the next tick retries; the socket stays useful
    }
  };

  const onAuthSuccess = (freshPayload: HealthTokenPayload): void => {
    payload = freshPayload;
    if (authTimer) {
      clearTimeout(authTimer);
      authTimer = null;
    }
    send({ type: 'auth-ok' });

    // (Re)start the push loop — a refresh just restarts the cadence
    stopPush();
    void pushStats();
    pushTimer = setInterval(() => void pushStats(), HEALTH_STATS_INTERVAL_MS);
  };

  socket.on('message', (data) => {
    if (closed) return;

    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      send({ type: 'error', code: 'invalid-message' });
      return;
    }
    const parsed = healthClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      send({ type: 'error', code: 'invalid-message' });
      return;
    }

    // The only client message is `auth` — everything else is rejected
    try {
      onAuthSuccess(verifyHealthToken(parsed.data.token, secret));
    } catch {
      send({ type: 'error', code: 'unauthorized' });
      closeWith(WS_CLOSE_UNAUTHORIZED);
    }
  });
}
