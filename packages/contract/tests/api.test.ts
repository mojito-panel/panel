import { describe, it, expect } from 'vitest';
import {
  healthResponseSchema,
  installServerRequestSchema,
  serverActionSchema,
  sendCommandRequestSchema,
  serverInfoSchema,
  installProgressSchema,
  logLineSchema,
  wsMessageSchema,
  AGENT_ROUTES,
} from '../src/api';

describe('healthResponseSchema', () => {
  it('valide une réponse health correcte', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejette un status autre que ok', () => {
    const result = healthResponseSchema.safeParse({
      status: 'error',
      version: '0.1.0',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(false);
  });
});

describe('installServerRequestSchema', () => {
  it('valide une requête d\'installation', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'mon-serveur',
      plugin: { id: 'minecraft' },
      variables: { RAM_MB: 2048, motd: 'Hello' },
      installDir: 'C:\\PanelData\\servers\\abc',
      allocation: { port: 25565, memoryMb: 4096 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allocation.ip).toBe('0.0.0.0'); // default
    }
  });

  it('rejette une installation sans allocation', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'mon-serveur',
      plugin: {},
      variables: {},
      installDir: '/tmp',
    });
    expect(result.success).toBe(false);
  });

  it('rejette un serverId non-UUID', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: 'not-a-uuid',
      plugin: {},
      variables: {},
      installDir: '/tmp',
    });
    expect(result.success).toBe(false);
  });
});

describe('serverActionSchema', () => {
  it.each(['start', 'stop', 'restart', 'kill'] as const)('accepte l\'action %s', (action) => {
    expect(serverActionSchema.safeParse(action).success).toBe(true);
  });

  it('rejette une action inconnue', () => {
    expect(serverActionSchema.safeParse('pause').success).toBe(false);
  });
});

describe('sendCommandRequestSchema', () => {
  it('rejette une commande vide', () => {
    const result = sendCommandRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      command: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('serverInfoSchema', () => {
  it('valide un statut running avec pid', () => {
    const result = serverInfoSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'running',
      pid: 1234,
      ramMb: 512.5,
      cpuPercent: 12.3,
      startedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('valide un statut stopped sans métriques', () => {
    const result = serverInfoSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'stopped',
      pid: null,
      ramMb: null,
      cpuPercent: null,
      startedAt: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('installProgressSchema', () => {
  it('valide une progression', () => {
    const result = installProgressSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      step: 2,
      totalSteps: 5,
      message: 'Téléchargement du serveur...',
      percent: 40,
    });
    expect(result.success).toBe(true);
  });

  it('rejette un pourcentage > 100', () => {
    const result = installProgressSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      step: 5,
      totalSteps: 5,
      message: 'done',
      percent: 150,
    });
    expect(result.success).toBe(false);
  });
});

describe('logLineSchema', () => {
  it('valide une ligne de log stdout', () => {
    const result = logLineSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: new Date().toISOString(),
      stream: 'stdout',
      line: '[12:00:00] [Server thread/INFO]: Done!',
    });
    expect(result.success).toBe(true);
  });
});

describe('wsMessageSchema', () => {
  it('valide un message install-progress', () => {
    const result = wsMessageSchema.safeParse({
      type: 'install-progress',
      payload: {
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        step: 1,
        totalSteps: 3,
        message: 'start',
        percent: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('valide un pong', () => {
    expect(wsMessageSchema.safeParse({ type: 'pong' }).success).toBe(true);
  });

  it('rejette un type inconnu', () => {
    expect(wsMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('AGENT_ROUTES', () => {
  it('définit toutes les routes attendues', () => {
    expect(AGENT_ROUTES.health).toBe('GET /health');
    expect(AGENT_ROUTES.install).toBe('POST /servers/install');
    expect(AGENT_ROUTES.action).toBe('POST /servers/:serverId/action');
    expect(AGENT_ROUTES.command).toBe('POST /servers/:serverId/command');
    expect(AGENT_ROUTES.info).toBe('GET /servers/:serverId');
    expect(AGENT_ROUTES.list).toBe('GET /servers');
    expect(AGENT_ROUTES.delete).toBe('DELETE /servers/:serverId');
  });
});
