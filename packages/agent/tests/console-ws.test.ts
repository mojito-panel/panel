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

const SECRET = 'ws-secret-0123456789abcdef0123456789abcdef';
const NODE = process.execPath;
const SERVER_ID = randomUUID();

/** Local signer (mirrors the panel side) used to forge test tokens. */
function signToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function tokenFor(serverId: string, permissions: Permission[] = [...ALL_PERMISSIONS]): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'user_1',
    serverId,
    permissions,
    iat: now,
    exp: now + 300,
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
    token: 'a'.repeat(64),
    jwtSecret: SECRET,
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

/** Opens a console socket and collects parsed messages. */
function openConsole(serverId: string, token: string | null): {
  ws: WebSocket;
  messages: ConsoleServerMessage[];
} {
  const url = `${wsBase}/servers/${serverId}/ws${token ? `?token=${token}` : ''}`;
  const ws = new WebSocket(url);
  const messages: ConsoleServerMessage[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ConsoleServerMessage);
  });
  return { ws, messages };
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

describe('Console WS — handshake', () => {
  it('ferme 4001 sans token', async () => {
    const { ws } = openConsole(SERVER_ID, null);
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  }, 10000);

  it('ferme 4001 avec un token invalide', async () => {
    const { ws } = openConsole(SERVER_ID, 'garbage.token.value');
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  }, 10000);

  it('ferme 4001 si le serverId du token ne correspond pas à la route', async () => {
    const { ws } = openConsole(SERVER_ID, tokenFor(randomUUID()));
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  }, 10000);

  it('ferme 4003 sans la permission console.read', async () => {
    const { ws } = openConsole(SERVER_ID, tokenFor(SERVER_ID, ['console.write']));
    const code = await closeCode(ws);
    expect(code).toBe(4003);
  }, 10000);

  it('accepte un token valide : auth-ok, batch initial, statut', async () => {
    const { ws, messages } = openConsole(SERVER_ID, tokenFor(SERVER_ID));
    await waitForMessage(messages, (m) => m.type === 'status');
    expect(messages[0]).toEqual({ type: 'auth-ok' });
    expect(messages[1]?.type).toBe('log');
    expect(messages.find((m) => m.type === 'status')).toEqual({ type: 'status', status: 'stopped' });
    await closeQuietly(ws);
  }, 10000);
});

describe('Console WS — streaming & actions', () => {
  it('streame les logs d un process démarré via power.start', async () => {
    const { ws, messages } = openConsole(SERVER_ID, tokenFor(SERVER_ID));
    await waitForMessage(messages, (m) => m.type === 'status');

    ws.send(JSON.stringify({ type: 'power', action: 'start' }));
    const log = await waitForMessage(
      messages,
      (m) => m.type === 'log' && m.lines.includes('hello-ws'),
    );
    expect(log.type).toBe('log');
    await closeQuietly(ws);
  }, 15000);

  it('rejette une commande sans console.write (error forbidden)', async () => {
    const { ws, messages } = openConsole(SERVER_ID, tokenFor(SERVER_ID, ['console.read']));
    await waitForMessage(messages, (m) => m.type === 'status');
    ws.send(JSON.stringify({ type: 'command', command: 'list' }));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'forbidden',
    );
    expect(error).toEqual({ type: 'error', code: 'forbidden' });
    await closeQuietly(ws);
  }, 10000);

  it('rejette power.start sans la permission (error forbidden)', async () => {
    const { ws, messages } = openConsole(SERVER_ID, tokenFor(SERVER_ID, ['console.read']));
    await waitForMessage(messages, (m) => m.type === 'status');
    ws.send(JSON.stringify({ type: 'power', action: 'start' }));
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'forbidden',
    );
    expect(error).toEqual({ type: 'error', code: 'forbidden' });
    await closeQuietly(ws);
  }, 10000);

  it('rejette un message illisible (error invalid-message)', async () => {
    const { ws, messages } = openConsole(SERVER_ID, tokenFor(SERVER_ID));
    await waitForMessage(messages, (m) => m.type === 'status');
    ws.send('not-json');
    const error = await waitForMessage(
      messages,
      (m) => m.type === 'error' && m.code === 'invalid-message',
    );
    expect(error).toEqual({ type: 'error', code: 'invalid-message' });
    await closeQuietly(ws);
  }, 10000);

  it('rate-limit les commandes au-delà de 10/s (error rate-limited)', async () => {
    const { ws, messages } = openConsole(
      SERVER_ID,
      tokenFor(SERVER_ID, ['console.read', 'console.write']),
    );
    await waitForMessage(messages, (m) => m.type === 'status');
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
    const { ws, messages } = openConsole(otherId, tokenFor(otherId));
    await waitForMessage(messages, (m) => m.type === 'status');
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
