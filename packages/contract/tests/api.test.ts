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
  permissionSchema,
  ALL_PERMISSIONS,
  CONSOLE_TOKEN_TTL_SECONDS,
  consoleTokenPayloadSchema,
  consoleTokenResponseSchema,
  consoleClientMessageSchema,
  consoleServerMessageSchema,
  consoleErrorSchema,
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
    expect(AGENT_ROUTES.consoleWs).toBe('GET /servers/:serverId/ws');
  });
});

describe('permissionSchema', () => {
  it('accepte chaque permission de la liste fermée', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permissionSchema.safeParse(permission).success).toBe(true);
    }
  });

  it('contient les permissions console/power/variables attendues', () => {
    expect(ALL_PERMISSIONS).toContain('console.read');
    expect(ALL_PERMISSIONS).toContain('console.write');
    expect(ALL_PERMISSIONS).toContain('power.start');
    expect(ALL_PERMISSIONS).toContain('power.stop');
    expect(ALL_PERMISSIONS).toContain('power.restart');
    expect(ALL_PERMISSIONS).toContain('power.kill');
    expect(ALL_PERMISSIONS).toContain('variables.read');
    expect(ALL_PERMISSIONS).toContain('variables.write');
  });

  it('rejette une permission hors liste', () => {
    expect(permissionSchema.safeParse('files.read').success).toBe(false);
  });
});

describe('consoleTokenPayloadSchema', () => {
  const validPayload = {
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'user_123',
    serverId: '550e8400-e29b-41d4-a716-446655440000',
    permissions: [...ALL_PERMISSIONS],
    iat: 1760000000,
    exp: 1760000000 + CONSOLE_TOKEN_TTL_SECONDS,
    jti: 'tok_abc',
  };

  it('valide un payload complet', () => {
    expect(consoleTokenPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejette un issuer inconnu', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, iss: 'evil' }).success,
    ).toBe(false);
  });

  it('rejette une audience autre que mojito-agent', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, aud: 'mojito-panel' }).success,
    ).toBe(false);
  });

  it('rejette une permission inconnue dans le payload', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({
        ...validPayload,
        permissions: ['console.read', 'admin.*'],
      }).success,
    ).toBe(false);
  });

  it('rejette un payload sans serverId ni jti', () => {
    const { serverId, jti, ...without } = validPayload;
    expect(consoleTokenPayloadSchema.safeParse(without).success).toBe(false);
    expect(serverId).toBeDefined();
    expect(jti).toBeDefined();
  });
});

describe('consoleTokenResponseSchema', () => {
  it('valide une réponse token + wsUrl', () => {
    expect(
      consoleTokenResponseSchema.safeParse({
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        wsUrl: 'ws://localhost:8080/servers/550e8400-e29b-41d4-a716-446655440000/ws',
      }).success,
    ).toBe(true);
  });

  it('rejette une réponse sans token', () => {
    expect(consoleTokenResponseSchema.safeParse({ wsUrl: 'ws://localhost/ws' }).success).toBe(false);
  });
});

describe('consoleClientMessageSchema', () => {
  it('valide une commande console', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'command', command: 'say hello' }).success,
    ).toBe(true);
  });

  it('rejette une commande vide', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'command', command: '' }).success,
    ).toBe(false);
  });

  it('valide une action power', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'power', action: 'restart' }).success,
    ).toBe(true);
  });

  it('rejette une action power inconnue', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'power', action: 'pause' }).success,
    ).toBe(false);
  });
});

describe('consoleServerMessageSchema', () => {
  it('valide auth-ok', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'auth-ok' }).success).toBe(true);
  });

  it('valide un batch de logs', () => {
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'log',
        lines: ['[12:00:00] [Server thread/INFO]: Done!'],
      }).success,
    ).toBe(true);
  });

  it('valide un statut et une erreur', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'status', status: 'running' }).success).toBe(true);
    expect(consoleServerMessageSchema.safeParse({ type: 'error', code: 'forbidden' }).success).toBe(true);
  });

  it('rejette un code d\'erreur inconnu', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'error', code: 'kaboom' }).success).toBe(false);
  });

  it('rejette un type inconnu', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'install-progress' }).success).toBe(false);
  });
});

describe('consoleErrorSchema', () => {
  it.each(['unauthorized', 'forbidden', 'invalid-message', 'rate-limited'] as const)(
    'accepte le code %s',
    (code) => {
      expect(consoleErrorSchema.safeParse(code).success).toBe(true);
    },
  );
});
