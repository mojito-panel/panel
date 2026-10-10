import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../src/router';
import type { AgentConfig } from '../src/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_TOKEN = 'a'.repeat(64); // 64 characters

const config: AgentConfig = {
  port: 0,
  host: '127.0.0.1',
  token: TEST_TOKEN,
  panelUrl: 'http://localhost:5173',
  allowedOrigins: [],
  dataDir: join(tmpdir(), 'mojito-api-data-' + process.pid),
  version: '0.1.0-test',
};

describe('Agent API (Fastify)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health (public)', () => {
    it('retourne 200 sans token', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0-test');
      expect(typeof body.uptimeSeconds).toBe('number');
    });
  });

  describe('Authentification Bearer token', () => {
    it('rejette une requête sans token (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/servers' });
      expect(res.statusCode).toBe(401);
    });

    it('rejette un mauvais token (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: `Bearer ${'b'.repeat(64)}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejette un header mal formé (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: 'Token abc' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('accepte le bon token (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ servers: [] });
    });
  });

  describe('GET /servers/:serverId (authentifié)', () => {
    it('retourne 404 pour un serveur inconnu', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers/550e8400-e29b-41d4-a716-446655440000',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not_found');
    });
  });
});

// ─── POST /servers/install route (runner) ─────────────────────────────────────

describe('Agent API — POST /servers/install', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

  const validPlugin = {
    schemaVersion: 2,
    id: 'test-plugin',
    name: 'Test',
    author: 'moi',
    variables: [{ env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 }],
    install: [{ action: 'write', file: 'marker.txt', content: 'port={{SERVER_PORT}}' }],
    start: { command: 'echo {{SERVER_PORT}}' },
  };

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();
    tmpDir = await mkdtemp(join(tmpdir(), 'mojito-api-'));
  });

  afterAll(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  const installBody = (overrides: Record<string, unknown> = {}) => ({
    serverId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'mon-serveur',
    plugin: validPlugin,
    variables: {},
    installDir: join(config.dataDir, 'srv'),
    allocation: { port: 25565, memoryMb: 2048 },
    ...overrides,
  });

  it('retourne 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      payload: installBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('retourne 400 si la requête est invalide (allocation manquante)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({ allocation: undefined }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Requête invalide');
  });

  it('retourne 400 si le plugin est invalide', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({ plugin: { foo: 'bar' } }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Plugin invalide');
  });

  it('installe un serveur valide et exécute le runner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.serverId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(body.status).toBe('stopped');

    // The runner did run the write action with the SERVER_PORT system variable
    const { readFile } = await import('node:fs/promises');
    const marker = await readFile(join(config.dataDir, 'srv', 'marker.txt'), 'utf-8');
    expect(marker).toBe('port=25565');
  });

  it('retourne 422 si une étape du runner échoue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        plugin: {
          ...validPlugin,
          install: [
            { action: 'download', url: 'http://127.0.0.1:1/missing.bin', dest: 'x.bin' },
          ],
        },
      }),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toContain('Étape 1');
  });

  it('après install : GET 200 stopped, action 404/400, command 409 sans process', async () => {
    // Install a valid server
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(200);

    const serverId = '550e8400-e29b-41d4-a716-446655440000';

    // GET: known server → 200, stopped status
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');

    // Action on unknown server → 404
    const action404 = await app.inject({
      method: 'POST',
      url: '/servers/660e8400-e29b-41d4-a716-446655440000/action',
      headers: auth,
      payload: { action: 'start' },
    });
    expect(action404.statusCode).toBe(404);

    // Invalid action → 400
    const action400 = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/action`,
      headers: auth,
      payload: { action: 'explode' },
    });
    expect(action400.statusCode).toBe(400);

    // Console command without a running process → 409
    const cmd = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/command`,
      headers: auth,
      payload: { command: 'say hi' },
    });
    expect(cmd.statusCode).toBe(409);

    // The server list contains the installed server
    const list = await app.inject({ method: 'GET', url: '/servers', headers: auth });
    expect(list.statusCode).toBe(200);
    const ids = list.json().servers.map((s: { serverId: string }) => s.serverId);
    expect(ids).toContain(serverId);
  });

  it('DELETE : 404 inconnu, supprime store + dossier, GET → 404 ensuite', async () => {
    const serverId = '550e8400-e29b-41d4-a716-446655440000';
    const { access } = await import('node:fs/promises');

    // DELETE on an unknown server → 404
    const del404 = await app.inject({
      method: 'DELETE',
      url: '/servers/660e8400-e29b-41d4-a716-446655440000',
      headers: auth,
    });
    expect(del404.statusCode).toBe(404);

    // Install a server
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(200);

    // The folder exists
    await expect(access(join(config.dataDir, 'srv', 'marker.txt'))).resolves.toBeUndefined();

    // DELETE → 200, folder removed (installDir under dataDir)
    const del = await app.inject({
      method: 'DELETE',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);
    await expect(access(join(config.dataDir, 'srv'))).rejects.toThrow();

    // The server is no longer known
    const info = await app.inject({ method: 'GET', url: `/servers/${serverId}`, headers: auth });
    expect(info.statusCode).toBe(404);

    // DELETE again → 404
    const again = await app.inject({
      method: 'DELETE',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
  });

  it('DELETE : 409 si le process tourne, 200 après kill', async () => {
    const serverId = '550e8400-e29b-41d4-a716-446655440000';

    // Install a server with a long-running process
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        plugin: {
          ...validPlugin,
          start: { command: `"${process.execPath}" -e "setInterval(() => {}, 1000);"` },
        },
      }),
    });
    expect(install.statusCode).toBe(200);

    // Start the process
    const start = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/action`,
      headers: auth,
      payload: { action: 'start' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe('running');

    // DELETE while running → 409
    const del409 = await app.inject({
      method: 'DELETE',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(del409.statusCode).toBe(409);

    // Kill then DELETE → 200
    const kill = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/action`,
      headers: auth,
      payload: { action: 'kill' },
    });
    expect(kill.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);
  });

  it('GET /servers/:id/logs : 404 inconnu, lignes incrémentales après install', async () => {
    const serverId = '550e8400-e29b-41d4-a716-446655440000';

    // Unknown server → 404
    const unknown = await app.inject({
      method: 'GET',
      url: '/servers/660e8400-e29b-41d4-a716-446655440000/logs',
      headers: auth,
    });
    expect(unknown.statusCode).toBe(404);

    // Install
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(200);

    // Logs without a process → empty, next=0
    const logs = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}/logs?after=0`,
      headers: auth,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().lines).toEqual([]);
    expect(logs.json().next).toBe(0);
    expect(logs.json().status).toBe('stopped');
  });

  it('installDir relatif est résolu sous le dataDir de l agent', async () => {
    // Does installBody send "servers/<uuid>"? No — here we check resolution:
    // a relative "rel-xyz" installDir must land under config.dataDir
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({ installDir: 'rel-check' }),
    });
    expect(install.statusCode).toBe(200);

    const { access } = await import('node:fs/promises');
    await expect(access(join(config.dataDir, 'rel-check', 'marker.txt'))).resolves.toBeUndefined();

    // Cleanup
    const del = await app.inject({
      method: 'DELETE',
      url: '/servers/550e8400-e29b-41d4-a716-446655440000',
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true); // under dataDir → removed
  });
});

// ─── POST /servers/:serverId/reinstall route ─────────────────────────────────

describe('Agent API — POST /servers/:serverId/reinstall', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };
  const serverId = '550e8400-e29b-41d4-a716-446655440000';

  const pluginWithContent = (content: string) => ({
    schemaVersion: 2,
    id: 'test-plugin',
    name: 'Test',
    author: 'moi',
    variables: [{ env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 }],
    install: [{ action: 'write', file: 'marker.txt', content }],
    start: { command: 'echo {{SERVER_PORT}}' },
  });

  const installBody = (content: string) => ({
    serverId,
    name: 'mon-serveur',
    plugin: pluginWithContent(content),
    variables: {},
    installDir: join(config.dataDir, 'srv'),
    allocation: { port: 25565, memoryMb: 2048 },
  });

  const reinstallBody = (overrides: Record<string, unknown> = {}) => ({
    plugin: pluginWithContent('reinstalled-port={{SERVER_PORT}}'),
    variables: {},
    ...overrides,
  });

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();
    tmpDir = await mkdtemp(join(tmpdir(), 'mojito-api-'));
  });

  afterAll(async () => {
    // Cleanup: delete the installed server
    await app.inject({ method: 'DELETE', url: `/servers/${serverId}`, headers: auth });
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('retourne 401 sans token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/reinstall`,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('retourne 404 pour un serveur inconnu', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/660e8400-e29b-41d4-a716-446655440000/reinstall',
      headers: auth,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('retourne 400 si le plugin est invalide', async () => {
    // Install first so the server is known (404 would mask the 400)
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody('port={{SERVER_PORT}}'),
    });
    expect(install.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/reinstall`,
      headers: auth,
      payload: reinstallBody({ plugin: { foo: 'bar' } }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Plugin invalide');
  });

  it('réinstalle : relance le runner dans le même dossier, statut stopped', async () => {
    // Install v1 → marker = port=25565
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody('port={{SERVER_PORT}}'),
    });
    expect(install.statusCode).toBe(200);

    const { readFile, rm: rmFile } = await import('node:fs/promises');
    const markerPath = join(config.dataDir, 'srv', 'marker.txt');
    expect(await readFile(markerPath, 'utf-8')).toBe('port=25565');

    // Reinstall with a NEW plugin version (different install content)
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/reinstall`,
      headers: auth,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.serverId).toBe(serverId);
    expect(body.status).toBe('stopped');

    // The runner re-ran in the SAME installDir with the STORED allocation
    expect(await readFile(markerPath, 'utf-8')).toBe('reinstalled-port=25565');

    // The store kept the server (with the updated plugin)
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');

    await rmFile(markerPath);
  });

  it('retourne 422 si une étape du runner échoue (état inchangé)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${serverId}/reinstall`,
      headers: auth,
      payload: reinstallBody({
        plugin: {
          ...pluginWithContent('x'),
          install: [
            { action: 'download', url: 'http://127.0.0.1:1/missing.bin', dest: 'x.bin' },
          ],
        },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('Étape 1');

    // The server is still known and stopped (store untouched)
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');
  });
});
