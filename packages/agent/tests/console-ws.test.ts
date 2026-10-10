import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentServer } from '../src/api';
import type { AgentConfig } from '../src/config';
import { ServerStore } from '../src/process/store';
import {
  ALL_PERMISSIONS,
  parsePlugin,
  type Permission,
  type ConsoleServerMessage,
} from '@mojito/contract';

/** Pelican-style: the agent's own bearer token IS the JWT signing key. */
const AGENT_TOKEN = 'agent-token-0123456789abcdef0123456789abcdef';
const PANEL_ORIGIN = 'http://localhost:5173';
const NODE = process.execPath;
const SERVER_ID = randomUUID();

/** Local signer (mirrors the panel side) used to forge test tokens. */
function signToken(payload: Record<string, unknown>, secret: string = AGENT_TOKEN): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function tokenFor(
  serverId: string,
  permissions: Permission[] = [...ALL_PERMISSIONS],
  expiresInSeconds = 300,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'user_1',
    serverId,
    permissions,
    scope: 'websocket',
    iat: now,
    exp: now + expiresInSeconds,
    jti: 'tok_ws_test',
  });
}

let app: FastifyInstance;
let wsBase: string;
let dataDir: string;
let store: ServerStore;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mojito-ws-'));
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

  // Stored server whose start command prints a line then exits cleanly
  store = new ServerStore(dataDir);
  const plugin = parsePlugin({
    schemaVersion: 2,
    id: 'ws-test-plugin',
    name: 'WS Test',
    author: 'moi',
    variables: [],
    install: [],
    start: {
      command: `"${NODE}" -e ${JSON.stringify(
        "console.log('hello-ws'); setTimeout(() => process.exit(0), 300);",
      )}`,
    },
  });
  await store.save({
    serverId: SERVER_ID,
    name: 'ws-server',
    plugin,
    variables: {},
    installDir: dataDir,
    allocation: { port: 25565, memoryMb: 1024, ip: '0.0.0.0' },
    installedAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Opens an (unauthenticated) console socket and collects parsed messages. */
function openConsole(serverId: string, origin: string | null = PANEL_ORIGIN): {
  ws: WebSocket;
  messages: ConsoleServerMessage[];
} {
  const url = `${wsBase}/servers/${serverId}/ws`;
  const ws = new WebSocket(url, origin === null ? {} : { headers: { Origin: origin } });
  const messages: ConsoleServerMessage[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ConsoleServerMessage);
  });
  return { ws, messages };
}

/** Authenticates with the given token and waits for the first status. */
async function authenticatedConsole(
  serverId: string,
  token: string = tokenFor(serverId),
) {
  const socket = openConsole(serverId);
  socket.ws.on('open', () => socket.ws.send(JSON.stringify({ type: 'auth', token })));
  await waitForMessage(socket.messages, (m) => m.type === 'status');
  return socket;
}

/** Resolves when a message matching the predicate arrives. */
function waitForMessage(
  messages: ConsoleServerMessage[],
  predicate: (m: ConsoleServerMessage) => boolean,
  timeoutMs = 8000,
): Promise<ConsoleServerMessage> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for message: ${JSON.stringify(messages)}`));
      }
      setTimeout(check, 25);
    };
    check();
  });
}

/** Waits for the socket to be closed and returns the close code. */
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

describe('Console WS — origin gate', () => {
  it('refuse une upgrade sans Origin (403 avant même le handshake)', async () => {
    const { ws } = openConsole(SERVER_ID, null);
    const failure = await new Promise<string>((resolve) => {
      ws.on('error', (err) => resolve((err as Error).message));
      ws.on('open', () => resolve('opened'));
    });
    expect(failure).toContain('403');
  }, 10000);

  it('refuse une Origin inconnue', async () => {
    const { ws } = openConsole(SERVER_ID, 'https://evil.example.com');
    const failure = await new Promise<string>((resolve) => {
      ws.on('error', (err) => resolve((err as Error).message));
      ws.on('open', () => resolve('opened'));
    });
    expect(failure).toContain('403');
  }, 10000);
});

describe('Console WS — handshake (auth message)', () => {
  it('ferme 4001 avec un token invalide (error unauthorized)', async () => {
    const { ws, messages } = openConsole(SERVER_ID);
    const closedPromise = closeCode(ws); // attach BEFORE the close can fire
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'garbage.token' })));
    const error = await waitForMessage(messages, (m) => m.type === 'error');
    expect(error).toEqual({ type: 'error', code: 'unauthorized' });
    expect(await closedPromise).toBe(4001);
  }, 10000);

  it('ferme 4001 si le serverId du token ne correspond pas à la route', async () => {
    const { ws, messages } = openConsole(SERVER_ID);
    const closedPromise = closeCode(ws);
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'auth', token: tokenFor(randomUUID()) })),
    );
    await waitForMessage(messages, (m) => m.type === 'error');
    expect(await closedPromise).toBe(4001);
  }, 10000);

  it('ferme 4003 sans la permission console.read', async () => {
    const { ws, messages } = openConsole(SERVER_ID);
    const closedPromise = closeCode(ws);
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'auth', token: tokenFor(SERVER_ID, ['console.write']) })),
    );
    const error = await waitForMessage(messages, (m) => m.type === 'error');
    expect(error).toEqual({ type: 'error', code: 'forbidden' });
    expect(await closedPromise).toBe(4003);
  }, 10000);

  it('accepte un token valide : auth-ok, batch initial, statut', async () => {
    const { ws, messages } = openConsole(SERVER_ID);
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'auth', token: tokenFor(SERVER_ID) })),
    );
    await waitForMessage(messages, (m) => m.type === 'status');
    expect(messages[0]).toEqual({ type: 'auth-ok' });
    expect(messages[1]?.type).toBe('log');
    expect(messages.find((m) => m.type === 'status')).toEqual({ type: 'status', status: 'stopped' });
    await closeQuietly(ws);
  }, 10000);

  it('rejette une action avant authentification', async () => {
    const { ws, messages } = openConsole(SERVER_ID);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'command', command: 'list' })));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'unauthorized',
    );
    expect(error).toEqual({ type: 'error', code: 'unauthorized' });
    await closeQuietly(ws);
  }, 10000);
});

describe('Console WS — streaming & actions', () => {
  it('streame les logs d un process démarré via power.start', async () => {
    const { ws, messages } = await authenticatedConsole(SERVER_ID);
    ws.send(JSON.stringify({ type: 'power', action: 'start' }));
    const log = await waitForMessage(
      messages,
      (m) => m.type === 'log' && m.lines.includes('hello-ws'),
    );
    expect(log.type).toBe('log');
    await closeQuietly(ws);
  }, 15000);

  it('rejette une commande sans console.write (error forbidden)', async () => {
    const { ws, messages } = await authenticatedConsole(
      SERVER_ID,
      tokenFor(SERVER_ID, ['console.read']),
    );
    ws.send(JSON.stringify({ type: 'command', command: 'list' }));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'forbidden',
    );
    expect(error).toEqual({ type: 'error', code: 'forbidden' });
    await closeQuietly(ws);
  }, 10000);

  it('rejette power.start sans la permission (error forbidden)', async () => {
    const { ws, messages } = await authenticatedConsole(
      SERVER_ID,
      tokenFor(SERVER_ID, ['console.read']),
    );
    ws.send(JSON.stringify({ type: 'power', action: 'start' }));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'forbidden',
    );
    expect(error).toEqual({ type: 'error', code: 'forbidden' });
    await closeQuietly(ws);
  }, 10000);

  it('rejette un message illisible (error invalid-message)', async () => {
    const { ws, messages } = await authenticatedConsole(SERVER_ID);
    ws.send('not-json');
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'invalid-message',
    );
    expect(error).toEqual({ type: 'error', code: 'invalid-message' });
    await closeQuietly(ws);
  }, 10000);

  it('rate-limit les commandes au-delà de 10/s (error rate-limited)', async () => {
    const { ws, messages } = await authenticatedConsole(
      SERVER_ID,
      tokenFor(SERVER_ID, ['console.read', 'console.write']),
    );
    for (let i = 0; i < 12; i++) {
      ws.send(JSON.stringify({ type: 'command', command: `cmd-${i}` }));
    }
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'rate-limited',
    );
    expect(error).toEqual({ type: 'error', code: 'rate-limited' });
    await closeQuietly(ws);
  }, 10000);

  it('répond par le statut courant quand la commande touche un serveur inconnu', async () => {
    const otherId = randomUUID();
    const { ws, messages } = await authenticatedConsole(otherId, tokenFor(otherId));
    ws.send(JSON.stringify({ type: 'command', command: 'list' }));
    // sendCommand → not_found → status reply (the socket stays open, no crash)
    await waitForMessage(
      messages,
      () => messages.filter((m) => m.type === 'status').length >= 2,
    );
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await closeQuietly(ws);
  }, 10000);
});

describe('Console WS — expiration & refresh (re-auth)', () => {
  it(
    'rejette une action quand le token expire en cours de connexion, puis re-auth succeed',
    async () => {
      // exp = now → passes the 5 s skew at auth, expired for messages after ~5 s
      const { ws, messages } = await authenticatedConsole(
        SERVER_ID,
        tokenFor(SERVER_ID, undefined, 0),
      );
      // Wait until the token is beyond the clock skew
      await new Promise((resolve) => setTimeout(resolve, 6000));
      ws.send(JSON.stringify({ type: 'command', command: 'list' }));
      const error = await waitForMessage(
        messages,
        (m) => m.type === 'error' && m.code === 'unauthorized',
      );
      expect(error).toEqual({ type: 'error', code: 'unauthorized' });

      // Re-auth with a fresh token on the SAME connection (Pelican-style refresh)
      const statusesBefore = messages.filter((m) => m.type === 'status').length;
      ws.send(JSON.stringify({ type: 'auth', token: tokenFor(SERVER_ID) }));
      await waitForMessage(messages, (m) => m.type === 'auth-ok');
      // Refresh acknowledges only — no duplicate status/batch
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(messages.filter((m) => m.type === 'status').length).toBe(statusesBefore);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await closeQuietly(ws);
    },
    20000,
  );
});
