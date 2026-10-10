import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../src/api';
import type { AgentConfig } from '../src/config';

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
