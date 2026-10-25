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
  installStatusSchema,
  nodeStatsSchema,
  updateServerResourcesRequestSchema,
  HEALTH_TOKEN_TTL_SECONDS,
  healthTokenPayloadSchema,
  healthServerMessageSchema,
  createBackupRequestSchema,
  restoreBackupRequestSchema,
  backupOperationStatusSchema,
  backupDownloadTokenPayloadSchema,
  BACKUP_DOWNLOAD_TOKEN_TTL_SECONDS,
} from '../src/contract/api';

describe('healthResponseSchema', () => {
  it('validates a correct health response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status other than ok', () => {
    const result = healthResponseSchema.safeParse({
      status: 'error',
      version: '0.1.0',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(false);
  });
});

describe('installServerRequestSchema', () => {
  it('validates an install request', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'my-server',
      recipe: { id: 'minecraft' },
      variables: { RAM_MB: 2048, motd: 'Hello' },
      installDir: 'C:\\PanelData\\servers\\abc',
      resources: { port: 25565, memoryMb: 4096 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources.ip).toBe('0.0.0.0'); // default
    }
  });

  it('rejects an install without resources', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'my-server',
      recipe: {},
      variables: {},
      installDir: '/tmp',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fractional cpuCores and defaults it to 0', () => {
    const fractional = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'my-server',
      recipe: {},
      variables: {},
      installDir: '/tmp',
      resources: { port: 25565, memoryMb: 4096, cpuCores: 1.5 },
    });
    expect(fractional.success).toBe(true);
    if (fractional.success) {
      expect(fractional.data.resources.cpuCores).toBe(1.5);
    }

    const omitted = installServerRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'my-server',
      recipe: {},
      variables: {},
      installDir: '/tmp',
      resources: { port: 25565, memoryMb: 4096 },
    });
    expect(omitted.success).toBe(true);
    if (omitted.success) {
      expect(omitted.data.resources.cpuCores).toBe(0); // 0 = unlimited
    }
  });

  it('rejects a negative or oversized cpuCores', () => {
    const base = {
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'my-server',
      recipe: {},
      variables: {},
      installDir: '/tmp',
    };
    expect(
      installServerRequestSchema.safeParse({
        ...base,
        resources: { port: 25565, memoryMb: 4096, cpuCores: -0.5 },
      }).success,
    ).toBe(false);
    expect(
      installServerRequestSchema.safeParse({
        ...base,
        resources: { port: 25565, memoryMb: 4096, cpuCores: 2048 },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty serverId', () => {
    const result = installServerRequestSchema.safeParse({
      serverId: '',
      recipe: {},
      variables: {},
      installDir: '/tmp',
    });
    expect(result.success).toBe(false);
  });
});

describe('serverActionSchema', () => {
  it.each(['start', 'stop', 'restart', 'kill'] as const)('accepts action %s', (action) => {
    expect(serverActionSchema.safeParse(action).success).toBe(true);
  });

  it('rejects an unknown action', () => {
    expect(serverActionSchema.safeParse('pause').success).toBe(false);
  });
});

describe('sendCommandRequestSchema', () => {
  it('rejects an empty command', () => {
    const result = sendCommandRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      command: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateServerResourcesRequestSchema', () => {
  it('validates a full resources update (limits sync)', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565, ip: '192.168.1.10', memoryMb: 4096, cpuCores: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a partial record (port/ip only)', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565, ip: '192.168.1.10' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer port', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565.5, ip: '192.168.1.10', memoryMb: 4096, cpuCores: 1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty ip', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565, ip: '', memoryMb: 4096, cpuCores: 1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty serverId', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '',
      resources: { port: 25565, ip: '192.168.1.10' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts secondary ports in the record', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: {
        port: 25565,
        ip: '192.168.1.10',
        memoryMb: 4096,
        cpuCores: 0,
        ports: [25566, 27015],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources.ports).toEqual([25566, 27015]);
    }
  });

  it('defaults the secondary ports to an empty list (old agent record)', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565, ip: '192.168.1.10', memoryMb: 4096, cpuCores: 0 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources.ports).toEqual([]);
    }
  });

  it('rejects an invalid secondary port', () => {
    const result = updateServerResourcesRequestSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      resources: { port: 25565, ip: '192.168.1.10', memoryMb: 4096, cpuCores: 0, ports: [0] },
    });
    expect(result.success).toBe(false);
  });
});

describe('serverInfoSchema', () => {
  it('validates a running status with pid', () => {
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

  it('validates a stopped status without metrics', () => {
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
  it('validates a progress payload', () => {
    const result = installProgressSchema.safeParse({
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      step: 2,
      totalSteps: 5,
      message: 'Downloading the server...',
      percent: 40,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a percent > 100', () => {
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
  it('validates a stdout log line', () => {
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
  it('validates an install-progress message', () => {
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

  it('validates a pong', () => {
    expect(wsMessageSchema.safeParse({ type: 'pong' }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(wsMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('permissionSchema', () => {
  it('accepts each permission from the closed list', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permissionSchema.safeParse(permission).success).toBe(true);
    }
  });

  it('rejects a permission outside the list', () => {
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
    scope: 'websocket',
    iat: 1760000000,
    exp: 1760000000 + CONSOLE_TOKEN_TTL_SECONDS,
    jti: 'tok_abc',
  };

  it('validates a complete payload', () => {
    expect(consoleTokenPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects an unknown issuer', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, iss: 'evil' }).success,
    ).toBe(false);
  });

  it('rejects an audience other than mojito-agent', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, aud: 'mojito-panel' }).success,
    ).toBe(false);
  });

  it('rejects an unknown permission in the payload', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({
        ...validPayload,
        permissions: ['console.read', 'admin.*'],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty serverId', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, serverId: '' }).success,
    ).toBe(false);
  });

  it('rejects a scope other than websocket', () => {
    expect(
      consoleTokenPayloadSchema.safeParse({ ...validPayload, scope: 'file-upload' }).success,
    ).toBe(false);
  });
});

describe('consoleTokenResponseSchema', () => {
  it('validates a token + wsUrl response', () => {
    expect(
      consoleTokenResponseSchema.safeParse({
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        wsUrl: 'ws://localhost:8080/servers/550e8400-e29b-41d4-a716-446655440000/ws',
      }).success,
    ).toBe(true);
  });

  it('rejects a response without token', () => {
    expect(consoleTokenResponseSchema.safeParse({ wsUrl: 'ws://localhost/ws' }).success).toBe(false);
  });
});

describe('consoleClientMessageSchema', () => {
  it('validates the auth message (JWT handshake)', () => {
    expect(
      consoleClientMessageSchema.safeParse({
        type: 'auth',
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      }).success,
    ).toBe(true);
  });

  it('rejects auth without token', () => {
    expect(consoleClientMessageSchema.safeParse({ type: 'auth' }).success).toBe(false);
  });

  it('validates a console command', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'command', command: 'say hello' }).success,
    ).toBe(true);
  });

  it('rejects an empty command', () => {
    expect(
      consoleClientMessageSchema.safeParse({ type: 'command', command: '' }).success,
    ).toBe(false);
  });
});

describe('consoleServerMessageSchema', () => {
  it('validates auth-ok', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'auth-ok' }).success).toBe(true);
  });

  it('validates a log batch', () => {
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'log',
        lines: ['[12:00:00] [Server thread/INFO]: Done!'],
      }).success,
    ).toBe(true);
  });

  it('validates a status and an error', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'status', status: 'running' }).success).toBe(true);
    // Every runtime status flows over the WS — starting/stopping included.
    expect(consoleServerMessageSchema.safeParse({ type: 'status', status: 'starting' }).success).toBe(true);
    expect(consoleServerMessageSchema.safeParse({ type: 'status', status: 'stopping' }).success).toBe(true);
    expect(consoleServerMessageSchema.safeParse({ type: 'error', code: 'forbidden' }).success).toBe(true);
  });

  it('validates an install-status (live banner)', () => {
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-status',
        status: 'installing',
        step: 2,
        totalSteps: 7,
        percent: 28,
        message: 'Step 2/7 — Download',
        error: null,
      }).success,
    ).toBe(true);
  });

  it('validates an install-log (replay reset + rewrite replace)', () => {
    const line = { timestamp: new Date().toISOString(), level: 'step', message: 'Step 1/2' };
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-log',
        lines: [line],
        reset: true,
        replace: false,
      }).success,
    ).toBe(true);
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-log',
        lines: [{ ...line, level: 'info', message: 'progress 42%' }],
        replace: true,
      }).success,
    ).toBe(true);
  });

  it('validates an install-log with coded lines (code + params)', () => {
    const coded = {
      timestamp: new Date().toISOString(),
      level: 'step',
      message: '',
      code: 'install.action.download',
      params: { step: '1', total: '2', dest: 'server.jar' },
    };
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-log',
        lines: [coded],
      }).success,
    ).toBe(true);
  });

  it('rejects an install-log with an unknown level', () => {
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-log',
        lines: [{ timestamp: new Date().toISOString(), level: 'verbose', message: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('validates a coded install-status (current step message)', () => {
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'install-status',
        status: 'installing',
        step: 2,
        totalSteps: 7,
        percent: 28,
        message: '',
        code: 'install.action.download',
        params: { dest: 'server.jar' },
        error: null,
      }).success,
    ).toBe(true);
  });

  it('validates a runtime event (power action / server online)', () => {
    expect(
      consoleServerMessageSchema.safeParse({ type: 'event', code: 'power.start' }).success,
    ).toBe(true);
    expect(
      consoleServerMessageSchema.safeParse({
        type: 'event',
        code: 'server.online',
        params: {},
      }).success,
    ).toBe(true);
  });

  it('rejects an event without a code', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'event' }).success).toBe(false);
  });

  it('rejects an unknown error code', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'error', code: 'kaboom' }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(consoleServerMessageSchema.safeParse({ type: 'install-progress' }).success).toBe(false);
  });
});

describe('consoleErrorSchema', () => {
  it.each(['unauthorized', 'forbidden', 'invalid-message', 'rate-limited'] as const)(
    'accepts code %s',
    (code) => {
      expect(consoleErrorSchema.safeParse(code).success).toBe(true);
    },
  );
});

// ─── installStatusSchema ─────────────────────────────────────────────────────

describe('installStatusSchema', () => {
  const valid = {
    serverId: '550e8400-e29b-41d4-a716-446655440000',
    status: 'installing',
    step: 2,
    totalSteps: 6,
    percent: 33,
    message: 'Step 2/6 — Downloading server.jar',
    error: null,
    logs: [
      { timestamp: new Date().toISOString(), level: 'info', message: 'Installation started' },
      { timestamp: new Date().toISOString(), level: 'step', message: 'Step 1/6 — Downloading server.jar' },
      { timestamp: new Date().toISOString(), level: 'error', message: 'stderr: warning' },
    ],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  it('validates an in-progress install status', () => {
    expect(installStatusSchema.safeParse(valid).success).toBe(true);
  });

  it('validates a coded current-step message (code + params)', () => {
    expect(
      installStatusSchema.safeParse({
        ...valid,
        message: '',
        code: 'install.action.download',
        params: { dest: 'server.jar' },
      }).success,
    ).toBe(true);
  });

  it('validates a failed status with error', () => {
    expect(
      installStatusSchema.safeParse({
        ...valid,
        status: 'failed',
        error: 'Step 1 — Download failed (404 Not Found)',
        finishedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(installStatusSchema.safeParse({ ...valid, status: 'kaboom' }).success).toBe(false);
  });

  it('rejects an unknown log level', () => {
    expect(
      installStatusSchema.safeParse({
        ...valid,
        logs: [{ timestamp: new Date().toISOString(), level: 'verbose', message: 'x' }],
      }).success,
    ).toBe(false);
  });
});

// ─── Node health (admin dashboard) ───────────────────────────────────────────

describe('nodeStatsSchema', () => {
  const valid = {
    timestamp: new Date().toISOString(),
    cpuPercent: 12.5,
    memoryUsedMb: 4096,
    memoryTotalMb: 16384,
    diskUsedGb: 250.5,
    diskTotalGb: 512,
    uptimeSeconds: 3600,
    version: '0.1.0',
    serversRunning: 3,
  };

  it('validates correct node stats', () => {
    expect(nodeStatsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an unavailable disk (null)', () => {
    expect(
      nodeStatsSchema.safeParse({ ...valid, diskUsedGb: null, diskTotalGb: null }).success,
    ).toBe(true);
  });

  it('rejects an out-of-bounds cpuPercent', () => {
    expect(nodeStatsSchema.safeParse({ ...valid, cpuPercent: 120 }).success).toBe(false);
  });

  it('rejects a zero total memory', () => {
    expect(nodeStatsSchema.safeParse({ ...valid, memoryTotalMb: 0 }).success).toBe(false);
  });
});

describe('healthTokenPayloadSchema', () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = {
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'user_1',
    scope: 'health',
    iat: now,
    exp: now + HEALTH_TOKEN_TTL_SECONDS,
    jti: 'tok_health_test',
  };

  it('validates a correct health payload', () => {
    expect(healthTokenPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects the console scope (distinct scopes)', () => {
    expect(healthTokenPayloadSchema.safeParse({ ...valid, scope: 'websocket' }).success).toBe(
      false,
    );
  });

  it('rejects a payload without jti', () => {
    const { jti: _jti, ...withoutJti } = valid;
    expect(healthTokenPayloadSchema.safeParse(withoutJti).success).toBe(false);
  });
});

describe('healthServerMessageSchema', () => {
  it('validates a stats frame', () => {
    const result = healthServerMessageSchema.safeParse({
      type: 'stats',
      stats: {
        timestamp: new Date().toISOString(),
        cpuPercent: 5,
        memoryUsedMb: 1000,
        memoryTotalMb: 2000,
        diskUsedGb: null,
        diskTotalGb: null,
        uptimeSeconds: 10,
        version: '0.1.0',
        serversRunning: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('validates auth-ok and rejects an unknown type', () => {
    expect(healthServerMessageSchema.safeParse({ type: 'auth-ok' }).success).toBe(true);
    expect(healthServerMessageSchema.safeParse({ type: 'log', lines: [] }).success).toBe(false);
  });
});

describe('backup API (panel orchestrates, agent archives & restores)', () => {
  const serverId = '6f6c3c8e-0b7a-4a2e-9f2b-3a1d4c5e6f70';
  const backupId = '9d8b0f6e-2c4a-4e8f-9a3b-5c7d1e2f3a4b';

  it('validates a create backup request', () => {
    const result = createBackupRequestSchema.safeParse({
      serverId,
      backupId,
      include: ['world/**'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include).toEqual(['world/**']);
    }
  });

  it('defaults truncate to false on a restore request', () => {
    const result = restoreBackupRequestSchema.parse({ serverId });
    expect(result.truncate).toBe(false);
  });

  it('rejects empty ids on a create backup request', () => {
    expect(
      createBackupRequestSchema.safeParse({ serverId, backupId: '' }).success,
    ).toBe(false);
  });

  it('validates a running operation status', () => {
    const result = backupOperationStatusSchema.safeParse({
      serverId,
      backupId,
      operation: 'create',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sizeBytes).toBe(0);
      expect(result.data.checksum).toBeNull();
      expect(result.data.finishedAt).toBeNull();
    }
  });

  it('rejects an unknown operation', () => {
    const result = backupOperationStatusSchema.safeParse({
      serverId,
      backupId,
      operation: 'prune',
      status: 'running',
    });
    expect(result.success).toBe(false);
  });

  it('validates a backup download token payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = backupDownloadTokenPayloadSchema.safeParse({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'user-1',
      serverId,
      backupId,
      scope: 'backup-download',
      iat: now,
      exp: now + BACKUP_DOWNLOAD_TOKEN_TTL_SECONDS,
      jti: 'jti-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a backup download token bound to another scope', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = backupDownloadTokenPayloadSchema.safeParse({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'user-1',
      serverId,
      backupId,
      scope: 'websocket',
      iat: now,
      exp: now + BACKUP_DOWNLOAD_TOKEN_TTL_SECONDS,
      jti: 'jti-1',
    });
    expect(result.success).toBe(false);
  });

});
