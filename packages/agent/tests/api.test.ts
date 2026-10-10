import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../src/api';
import type { AgentConfig } from '../src/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_TOKEN = 'a'.repeat(64); // 64 caractères

const config: AgentConfig = {
  port: 0,
  host: '127.0.0.1',
  token: TEST_TOKEN,
  dataDir: 'C:\PanelData',
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
    it('retourne un statut stopped par défaut', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers/550e8400-e29b-41d4-a716-446655440000',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.serverId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(body.status).toBe('stopped');
      expect(body.pid).toBeNull();
    });
  });
});

// ─── Route POST /servers/install (runner) ─────────────────────────────────────

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
    installDir: join(tmpDir, 'srv'),
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

    // Le runner a bien exécuté l'action write avec la variable système SERVER_PORT
    const { readFile } = await import('node:fs/promises');
    const marker = await readFile(join(tmpDir, 'srv', 'marker.txt'), 'utf-8');
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
});
