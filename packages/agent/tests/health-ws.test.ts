import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentServer } from '../src/router';
import type { AgentConfig } from '../src/config';
import { nodeStatsSchema, type HealthServerMessage } from '@mojito/contract';

/** Pelican-style: the agent's own bearer token IS the JWT signing key. */
const AGENT_TOKEN = 'agent-token-0123456789abcdef0123456789abcdef';
const PANEL_ORIGIN = 'http://localhost:5173';

/** Local signer (mirrors the panel side) used to forge test tokens. */
function signToken(payload: Record<string, unknown>, secret: string = AGENT_TOKEN): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function healthToken(expiresInSeconds = 300): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'admin_1',
    scope: 'health',
    iat: now,
    exp: now + expiresInSeconds,
    jti: randomUUID(),
  });
}

let app: FastifyInstance;
let wsBase: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mojito-health-'));
  const config: AgentConfig = {
    port: 0,
    host: '127.0.0.1',
    token: AGENT_TOKEN,
    panelUrl: PANEL_ORIGIN,
    allowedOrigins: [],
    dataDir,
    version: '0.1.0-test',
  };
  app = createAgentServer(config);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  wsBase = `ws://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Opens an (unauthenticated) health socket and collects parsed messages. */
function openHealth(origin: string | null = PANEL_ORIGIN): {
  ws: WebSocket;
  messages: HealthServerMessage[];
} {
  const ws = new WebSocket(`${wsBase}/health/ws`, origin === null ? {} : { headers: { Origin: origin } });
  const messages: HealthServerMessage[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as HealthServerMessage);
  });
  return { ws, messages };
}

function waitForMessage(
  messages: HealthServerMessage[],
  predicate: (m: HealthServerMessage) => boolean,
  timeoutMs = 8000,
): Promise<HealthServerMessage> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout: ${JSON.stringify(messages)}`));
      }
      setTimeout(check, 25);
    };
    check();
  });
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => undefined);
  });
}

function closeQuietly(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', () => resolve());
    ws.close();
    setTimeout(resolve, 3000);
  });
}

describe('Health WS — origin gate', () => {
  it('refuses the upgrade without Origin (403 before the handshake)', async () => {
    const { ws } = openHealth(null);
    const failure = await new Promise<string>((resolve) => {
      ws.on('error', (err) => resolve((err as Error).message));
      ws.on('open', () => resolve('opened'));
    });
    expect(failure).toContain('403');
  }, 10000);

  it('refuses an unknown Origin', async () => {
    const { ws } = openHealth('https://evil.example.com');
    const failure = await new Promise<string>((resolve) => {
      ws.on('error', (err) => resolve((err as Error).message));
      ws.on('open', () => resolve('opened'));
    });
    expect(failure).toContain('403');
  }, 10000);
});

describe('Health WS — handshake (auth message)', () => {
  it('closes with 4001 on an invalid token', async () => {
    const { ws, messages } = openHealth();
    const closed = closeCode(ws);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'garbage.token' })));
    const error = await waitForMessage(messages, (m) => m.type === 'error');
    expect(error).toEqual({ type: 'error', code: 'unauthorized' });
    expect(await closed).toBe(4001);
  }, 10000);

  it('closes with 4001 on a console-scoped token (distinct scopes)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const consoleScoped = signToken({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'admin_1',
      serverId: randomUUID(),
      permissions: ['console.read'],
      scope: 'websocket',
      iat: now,
      exp: now + 300,
      jti: randomUUID(),
    });
    const { ws, messages } = openHealth();
    const closed = closeCode(ws);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: consoleScoped })));
    const error = await waitForMessage(messages, (m) => m.type === 'error');
    expect(error).toEqual({ type: 'error', code: 'unauthorized' });
    expect(await closed).toBe(4001);
  }, 10000);

  it('rejects an unreadable message (error invalid-message)', async () => {
    const { ws, messages } = openHealth();
    ws.on('open', () => ws.send('not-json'));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'invalid-message',
    );
    expect(error).toEqual({ type: 'error', code: 'invalid-message' });
    await closeQuietly(ws);
  }, 10000);
});

describe('Health WS — stats stream', () => {
  it('pushes auth-ok then valid stats frames, at a regular interval', async () => {
    const { ws, messages } = openHealth();
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: healthToken() })));
    // Cast: waitForMessage returns the union, this call site wants the stats frame
    const first = (await waitForMessage(
      messages,
      (m) => m.type === 'stats',
    )) as Extract<HealthServerMessage, { type: 'stats' }>;
    expect(messages[0]).toEqual({ type: 'auth-ok' });
    expect(nodeStatsSchema.safeParse(first.stats).success).toBe(true);
    expect(first.stats.version).toBe('0.1.0-test');
    expect(first.stats.memoryTotalMb).toBeGreaterThan(0);
    expect(first.stats.serversRunning).toBe(0);

    // Second frame — pushed by the agent without any client message
    await waitForMessage(
      messages,
      (m) => m.type === 'stats' && m !== first,
    );
    expect(messages.filter((m) => m.type === 'stats').length).toBeGreaterThanOrEqual(2);
    await closeQuietly(ws);
  }, 15000);

  it('closes with 4001 when the token expires mid-connection', async () => {
    const { ws, messages } = openHealth();
    const closed = closeCode(ws);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: healthToken(0) })));
    await waitForMessage(messages, (m) => m.type === 'auth-ok');
    // exp = now + 0 : the skew tolerates ~5 s → the next push tick closes
    expect(await closed).toBe(4001);
  }, 15000);

  it('refreshes the token without reconnecting (re-auth → auth-ok only)', async () => {
    const { ws, messages } = openHealth();
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: healthToken() })));
    await waitForMessage(messages, (m) => m.type === 'stats');

    const statsBefore = messages.filter((m) => m.type === 'stats').length;
    ws.send(JSON.stringify({ type: 'auth', token: healthToken() }));
    // Refresh acknowledges with a second auth-ok — the socket stays open
    await waitForMessage(messages, () => messages.filter((m) => m.type === 'auth-ok').length >= 2);
    // The re-auth restarts the cadence — a fresh stats frame must follow
    await waitForMessage(
      messages,
      () => messages.filter((m) => m.type === 'stats').length > statsBefore,
    );
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await closeQuietly(ws);
  }, 15000);
});

describe('REST /stats — panel snapshot (panel token)', () => {
  it('returns a valid snapshot with the panel token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: { authorization: `Bearer ${AGENT_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(nodeStatsSchema.safeParse(stats).success).toBe(true);
    expect(stats.version).toBe('0.1.0-test');
  });

  it('rejects with 401 without a panel token (the health JWT does not pass in REST)', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(401);
  });
});
