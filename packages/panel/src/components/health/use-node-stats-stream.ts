import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import type { HealthServerMessage, NodeStats } from '@mojito/contract';
import { createNodeHealthTokenFn } from '~/server/functions/admin';

/**
 * Live node stats stream (browser ↔ agent DIRECT WebSocket) — the panel only
 * issues the short-lived health JWT, it never relays a frame (PR #2558
 * semantics: the graphs read the live push, nothing polls).
 *
 * Same lifecycle as the console socket: the token is refreshed in-place by
 * re-sending `auth` before it expires; if the socket dies (agent restart,
 * token expiry, network) the hook reconnects with a fresh token.
 */

export type NodeStreamState = 'connecting' | 'live' | 'disconnected';

/** Rolling buffer — 120 samples at one frame / 2 s = the last 4 minutes. */
export const MAX_SAMPLES = 120;
/** Refresh the health token this long before its expiry (in-place re-auth). */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Reconnect backoff after a dropped socket. */
const RECONNECT_DELAY_MS = 5000;

export interface NodeStatsStream {
  connection: NodeStreamState;
  /** Latest pushed frame — null until the first one arrives. */
  stats: NodeStats | null;
  /** Rolling sample buffer (oldest → newest), for the charts. */
  samples: NodeStats[];
}

export function useNodeStatsStream(nodeId: string): NodeStatsStream {
  const createToken = useServerFn(createNodeHealthTokenFn);
  const [connection, setConnection] = useState<NodeStreamState>('connecting');
  const [stats, setStats] = useState<NodeStats | null>(null);
  const [samples, setSamples] = useState<NodeStats[]>([]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Expiry of the token CURRENTLY in flight (connect or reauth). The next
     * refresh is ONLY scheduled on `auth-ok` — from this value — otherwise a
     * stale expiresAt re-arms the timer 1 s in the past and reauths forever.
     */
    let currentExpiresAt = 0;

    const clearRefreshTimer = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const cleanup = () => {
      disposed = true;
      clearRefreshTimer();
      clearReconnectTimer();
      socket?.close();
      socket = null;
    };

    const scheduleReconnect = () => {
      clearRefreshTimer();
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, RECONNECT_DELAY_MS);
    };

    /**
     * Refresh cadence — called ONLY on `auth-ok`, from the expiry of the
     * token the agent has just accepted. The margin keeps the re-auth in-place.
     */
    const scheduleRefresh = () => {
      clearRefreshTimer();
      const delay = currentExpiresAt - TOKEN_REFRESH_MARGIN_MS - Date.now();
      refreshTimer = setTimeout(() => void reauth(), Math.max(1000, delay));
    };

    /** Fetches a fresh token and re-sends `auth` on the LIVE socket. */
    const reauth = async () => {
      try {
        const fresh = await createToken({ data: { nodeId } });
        if (disposed || !socket || socket.readyState !== WebSocket.OPEN) return;
        currentExpiresAt = fresh.expiresAt;
        socket.send(JSON.stringify({ type: 'auth', token: fresh.token }));
        // No scheduling here — auth-ok (or the expiry close) drives the cadence
      } catch {
        // Token unreachable (panel error) — the expiry close will trigger a reconnect
        clearRefreshTimer();
      }
    };

    const connect = async () => {
      let tokenData: Awaited<ReturnType<typeof createToken>>;
      try {
        tokenData = await createToken({ data: { nodeId } });
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) return;

      currentExpiresAt = tokenData.expiresAt;
      setConnection('connecting');
      socket = new WebSocket(tokenData.wsUrl);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token: tokenData.token }));
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        let message: HealthServerMessage;
        try {
          message = JSON.parse(event.data as string) as HealthServerMessage;
        } catch {
          return;
        }
        if (message.type === 'auth-ok') {
          setConnection('live');
          scheduleRefresh();
          return;
        }
        if (message.type === 'stats') {
          setStats(message.stats);
          setSamples((prev) => {
            const next = prev.length >= MAX_SAMPLES ? prev.slice(1) : [...prev];
            next.push(message.stats);
            return next;
          });
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setConnection('disconnected');
        scheduleReconnect();
      };
    };

    void connect();
    return cleanup;
  }, [nodeId, createToken]);

  return { connection, stats, samples };
}
