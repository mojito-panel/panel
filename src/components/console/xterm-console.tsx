import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import '@xterm/xterm/css/xterm.css';
import {
  CONSOLE_TOKEN_TTL_SECONDS,
  type ConsoleClientMessage,
  type ConsoleInstallStatus,
  type ConsoleServerMessage,
  type ServerStats,
} from '~/contract';
import { createConsoleTokenFn } from '~/server/functions/servers';
import { consoleMessageEmoji, renderConsoleEvent } from './messages';
import { Skeleton } from '~/components/ui/skeleton';

export type ConsoleMode = 'connecting' | 'ws';

interface XtermConsoleProps {
  serverId: string;
  /**
   * Called when the direct agent WS authenticates/disconnects.
   * Non-null = live WS sender usable for console commands (bypasses the
   * panel); null = fall back to the panel server functions.
   */
  onConnection?: (send: ((message: ConsoleClientMessage) => void) | null) => void;
  /** Runtime status pushed by the agent over the WS. */
  onStatus?: (status: ConsoleServerMessage & { type: 'status' }) => void;
  /** WS connection state change — the page shows a degraded notice when null. */
  onMode?: (mode: ConsoleMode) => void;
  /** Install status pushed by the agent over the WS (steps, %, error). */
  onInstallStatus?: (status: ConsoleInstallStatus) => void;
  /**
   * Resource stats pushed by the agent over the WS (CPU/RAM cards):
   * the ring replay on connect, then one full frame per sampling tick.
   */
  onStats?: (stats: ServerStats) => void;
}

/** WS attempts before showing the terminal-level connection error. */
const WS_MAX_ATTEMPTS = 3;
/** Reconnect backoff cap (ms). */
const WS_BACKOFF_CAP_MS = 5000;
/** Slow retry cadence once the fast attempts gave up (e.g. panel down). */
const SLOW_RETRY_MS = 30_000;
/** Refresh the console token this long before its expiry (Pelican-style re-auth). */
const TOKEN_REFRESH_MARGIN_SECONDS = 60;

/**
 * Live server console (xterm.js), fed by a DIRECT WebSocket to the agent
 * (Pelican-style): the panel issues a short-lived console JWT, the browser
 * opens `ws://agent/servers/:id/ws` UNauthenticated and sends the JWT as the
 * first `auth` message (never in the URL). The token is refreshed in-place by
 * re-sending `auth` before it expires.
 * WS-only — no polling fallback: a failed connection retries with backoff
 * and the terminal itself shows the error.
 * The terminal is created dynamically in a useEffect (SSR-safe).
 */
export function XtermConsole({
  serverId,
  onConnection,
  onStatus,
  onMode,
  onInstallStatus,
  onStats,
}: XtermConsoleProps) {
  const [ready, setReady] = useState(false);
  const createToken = useServerFn(createConsoleTokenFn);
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks via refs: the WS connection must not be torn down on re-renders
  const onConnectionRef = useRef(onConnection);
  const onStatusRef = useRef(onStatus);
  const onModeRef = useRef(onMode);
  const onInstallStatusRef = useRef(onInstallStatus);
  const onStatsRef = useRef(onStats);
  useEffect(() => {
    onConnectionRef.current = onConnection;
    onStatusRef.current = onStatus;
    onModeRef.current = onMode;
    onInstallStatusRef.current = onInstallStatus;
    onStatsRef.current = onStats;
  });

  // The transport mode is owned by the page (via onMode) — no local state.
  const switchMode = (next: ConsoleMode) => {
    onModeRef.current?.(next);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let slowRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let fitRaf: number | null = null;
    let socket: WebSocket | null = null;
    let currentToken: string | null = null;

    // ─── Direct WS to the agent (console JWT issued by the panel) ────────
    const notifyConnection = (send: ((message: ConsoleClientMessage) => void) | null) => {
      onConnectionRef.current?.(send);
    };

    /**
     * Coded event rendering — ONE catalog for runtime AND install events:
     * power actions in cyan, watchdog findings (they end in a kill) in red,
     * install steps in yellow, install.done in green, install.failed in
     * red; the rest (server online/stopped) in green.
     */
    const eventColor = (code: string, params?: Record<string, string>): string => {
      if (code.startsWith('watchdog.') || code === 'install.failed' || code === 'server.crash_loop') return '\x1b[31m';
      if (code.startsWith('power.')) return '\x1b[36m';
      if (code === 'install.done') return '\x1b[32m';
      if (params?.step) return '\x1b[33m';
      return '\x1b[32m';
    };
    const writeEvent = (code: string, params: Record<string, string> | undefined, at?: number) => {
      if (!term) return;
      // One catalog for runtime AND install events (step envelope included).
      const text = renderConsoleEvent(code, params);
      if (text === null) return; // unknown code (old agent) — nothing to show
      const time = (at ? new Date(at) : new Date()).toLocaleTimeString('fr-FR');
      const emoji = consoleMessageEmoji(code) || (params?.step ? '🔧' : '');
      term.writeln(
        `\x1b[90m[${time}]\x1b[0m ${eventColor(code, params)}${emoji} ${text}\x1b[0m`,
      );
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => {
          void (async () => {
            try {
              // Fresh token before expiry — Pelican-style in-place re-auth
              const fresh = await createToken({ data: { serverId } });
              if (disposed || !socket || socket.readyState !== WebSocket.OPEN) return;
              currentToken = fresh.token;
              socket.send(JSON.stringify({ type: 'auth', token: fresh.token }));
            } catch {
              // Panel unreachable — the connection will drop and reconnect
            } finally {
              if (!disposed) scheduleRefresh();
            }
          })();
        },
        Math.max(1, CONSOLE_TOKEN_TTL_SECONDS - TOKEN_REFRESH_MARGIN_SECONDS) * 1000,
      );
    };

    const connect = async (attempt: number) => {
      if (disposed) return;
      // A reconnect superseded a pending slow retry — cancel it.
      if (slowRetryTimer) {
        clearTimeout(slowRetryTimer);
        slowRetryTimer = null;
      }

      // Fresh token at every attempt (short TTL — never reuse an old one)
      let wsUrl: string;
      try {
        const response = await createToken({ data: { serverId } });
        wsUrl = response.wsUrl;
        currentToken = response.token;
      } catch {
        // Panel unreachable / ownership refused — retry
        if (attempt >= WS_MAX_ATTEMPTS - 1) {
          if (term) term.writeln('\x1b[31m[error] Console connection failed — retrying later\x1b[0m');
          // Make "later" true: one more attempt every SLOW_RETRY_MS until
          // the panel answers again (e.g. a dev-server restart).
          slowRetryTimer = setTimeout(() => void connect(0), SLOW_RETRY_MS);
          return;
        }
        reconnectTimer = setTimeout(() => void connect(attempt + 1), 1000 * (attempt + 1));
        return;
      }
      if (disposed) return;

      let authenticated = false;
      const ws = new WebSocket(wsUrl); // unauthenticated — the JWT travels as the first message
      socket = ws;

      ws.onopen = () => {
        if (disposed || !currentToken) return;
        ws.send(JSON.stringify({ type: 'auth', token: currentToken }));
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        // A malformed frame (truncated write, partial UTF-16 through a
        // proxy…) must not kill the handler — drop it; the next frame
        // re-syncs the stream.
        let message: ConsoleServerMessage;
        try {
          message = JSON.parse(event.data.toString()) as ConsoleServerMessage;
        } catch {
          return;
        }
        if (message.type === 'auth-ok') {
          if (!authenticated) {
            authenticated = true;
            switchMode('ws');
            notifyConnection((clientMessage) => {
              if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(clientMessage));
              }
            });
            scheduleRefresh();
          }
          return;
        }
        if (message.type === 'log') {
          for (const line of message.lines) {
            term?.writeln(line);
          }
          return;
        }
        if (message.type === 'event') {
          // Coded event — runtime (power action, server online/stopped,
          // watchdog) AND install (start, steps, done/failed): one catalog,
          // one rendering path, one chronological stream.
          writeEvent(message.code, message.params, message.at);
          return;
        }
        if (message.type === 'install-status') {
          onInstallStatusRef.current?.(message);
          return;
        }
        if (message.type === 'stats') {
          // Full authoritative frame — the page replaces its state wholesale.
          onStatsRef.current?.(message.stats);
          return;
        }
        if (message.type === 'status') {
          onStatusRef.current?.(message);
          return;
        }
        if (message.type === 'error') {
          if (message.code === 'unauthorized' && currentToken && !disposed) {
            // Token expired/refresh failed — re-auth in place with a fresh one
            void (async () => {
              try {
                const fresh = await createToken({ data: { serverId } });
                currentToken = fresh.token;
                if (socket && socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: 'auth', token: fresh.token }));
                }
              } catch {
                // The connection will drop and reconnect
              }
            })();
            return;
          }
          term?.writeln(`\x1b[31m[${message.code}]\x1b[0m`);
        }
      };

      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        notifyConnection(null);
        if (disposed) return;

        if (!authenticated && attempt >= WS_MAX_ATTEMPTS - 1) {
          // WS not usable at all (origin refused, proxy without WS…) — the
          // terminal says so; the socket stays closed. No polling fallback.
          if (term) {
            term.writeln('\x1b[31m[error] Console connection failed — check the agent status\x1b[0m');
          }
          return;
        }
        // Reconnect with a fresh token (short TTL), capped backoff
        const delay = Math.min(1000 * (attempt + 1), WS_BACKOFF_CAP_MS);
        reconnectTimer = setTimeout(() => void connect(attempt + 1), delay);
      };
      // onerror → onclose follows, nothing to do here
    };

    const boot = async () => {
      const [{ Terminal }, { FitAddon: FitAddonClass }, { Unicode11Addon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-unicode11'),
      ]);

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        convertEol: true,
        fontSize: 13,
        scrollback: 5000,
        disableStdin: true,
        // The Unicode 11 addon registers its width tables through the proposed
        // `terminal.unicode` API — the getter throws without this flag.
        allowProposedApi: true,
        theme: { background: '#0d1117' },
      });
      const fit = new FitAddonClass();
      term.loadAddon(fit);
      // Unicode 11 width tables: the default Unicode 6 tables measure modern
      // emoji (🚀 🚦 📦 🚧 🛠️) as 1 cell while the font renders them 2 cells wide,
      // so the space after an emoji is eaten and the following text overlaps it.
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = '11';
      term.open(containerRef.current);
      fit.fit();
      setReady(true);

      // The container's height is viewport-based (calc(100vh-26rem), floor
      // 400px): the ResizeObserver below re-fits the grid on every change.
      // rAF debounce to coalesce cascading resizes.
      const scheduleFit = () => {
        if (fitRaf !== null) return;
        fitRaf = requestAnimationFrame(() => {
          fitRaf = null;
          if (!disposed) fit.fit();
        });
      };
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(containerRef.current);

      await connect(0);
    };

    void boot();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (slowRetryTimer) clearTimeout(slowRetryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (resizeObserver) resizeObserver.disconnect();
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
      socket?.close();
      term?.dispose();
    };
  }, [serverId, createToken]);

  // The caption lives in the page (card header) — this component renders
  // only the terminal container. Until the terminal has booted (dynamic
  // import + open), the box shows terminal-shaped skeleton lines — never
  // an empty black rectangle.
  return (
    <div className="relative h-[calc(100vh-26rem)] min-h-[400px] overflow-hidden rounded-md bg-[#0d1117] p-2">
      <div ref={containerRef} className="h-full w-full" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 p-2">
          <Skeleton className="w-2/3 bg-[#30363d]" />
          <Skeleton className="w-1/2 bg-[#30363d]" />
          <Skeleton className="w-3/4 bg-[#30363d]" />
          <Skeleton className="w-1/3 bg-[#30363d]" />
          <Skeleton className="w-2/3 bg-[#30363d]" />
        </div>
      )}
    </div>
  );
}
