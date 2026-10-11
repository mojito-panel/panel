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

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ID = '660e8400-e29b-41d4-a716-446655440000';

/**
 * Installs run IN THE BACKGROUND since the tracked-install rework:
 * POST /servers/install returns 202 immediately, the runner records every
 * step in the registry. This helper polls the install status until the
 * install completes (or fails) and returns the final status.
 */
async function waitForInstall(
  app: FastifyInstance,
  serverId: string,
  auth: Record<string, string>,
  timeoutMs = 10_000,
): Promise<{ status: string; error: string | null; logs: { message: string; level: string }[] }> {
  const startedAt = Date.now();
  for (;;) {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}/install`,
      headers: auth,
    });
    if (res.statusCode === 200) {
      const body = res.json();
      if (body.status === 'installed' || body.status === 'failed') {
        return body;
      }
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`The install for ${serverId} did not finish in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const validRecipe = (install: unknown[] = [
  { action: 'write', file: 'marker.txt', content: 'port={{SERVER_PORT}}' },
]) => ({
  schemaVersion: 2,
  id: 'test-recipe',
  name: 'Test',
  author: 'me',
  variables: [{ env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 }],
  install,
  start: { command: 'echo {{SERVER_PORT}}' },
});

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
    it('returns 200 without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0-test');
      expect(typeof body.uptimeSeconds).toBe('number');
    });
  });

  describe('Bearer token authentication', () => {
    it('rejects a request without a token (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/servers' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a wrong token (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: `Bearer ${'b'.repeat(64)}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a malformed header (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: 'Token abc' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('accepts the correct token (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ servers: [] });
    });
  });

  describe('GET /servers/:serverId (authenticated)', () => {
    it('returns 404 for an unknown server', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/servers/${OTHER_ID}`,
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not_found');
    });
  });
});

// ─── POST /servers/install route (runner, background) ────────────────────────

describe('Agent API — POST /servers/install', () => {
  let app: FastifyInstance;
  let tmpDir: string;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

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
    serverId: SERVER_ID,
    name: 'my-server',
    recipe: validRecipe(),
    variables: {},
    installDir: join(config.dataDir, 'srv'),
    allocation: { port: 25565, memoryMb: 2048 },
    ...overrides,
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      payload: installBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when the request is invalid (missing allocation)', async () => {
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

  it('returns 400 when the recipe is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({ recipe: { foo: 'bar' } }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Recette invalide');
  });

  it('returns 422 (immediate) when a template variable is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        recipe: validRecipe([
          { action: 'write', file: 'x.txt', content: '{{UNKNOWN_VAR}}' },
        ]),
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('UNKNOWN_VAR');
  });

  it('starts the install in the background (202) then runs it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.serverId).toBe(SERVER_ID);
    expect(body.status).toBe('installing');

    // The runner runs in the background — wait for completion
    const status = await waitForInstall(app, SERVER_ID, auth);
    expect(status.status).toBe('installed');
    expect(status.error).toBeNull();

    // The runner did run the write action with the SERVER_PORT system variable
    const { readFile } = await import('node:fs/promises');
    const marker = await readFile(join(config.dataDir, 'srv', 'marker.txt'), 'utf-8');
    expect(marker).toBe('port=25565');

    // The step-by-step trail is recorded (debugging aid)
    const logText = status.logs.map((l) => l.message).join('\n');
    expect(logText).toContain('Étape 1/1');
    expect(logText).toContain('Écriture de marker.txt');
    expect(logText).toContain('Installation terminée');
  });

  it('records command output (stdout) in the install logs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        recipe: validRecipe([
          { action: 'command', command: 'echo mojito-install-output' },
        ]),
      }),
    });
    expect(res.statusCode).toBe(202);

    const status = await waitForInstall(app, SERVER_ID, auth);
    expect(status.status).toBe('installed');
    const logText = status.logs.map((l) => l.message).join('\n');
    expect(logText).toContain('mojito-install-output');
    // Steps = 'step' level (yellow in the panel), command output = 'info' (grey)
    const stepLine = status.logs.find((l) => l.message.startsWith('Étape 1/1'));
    expect(stepLine?.level).toBe('step');
    const outputLine = status.logs.find((l) => l.message === 'mojito-install-output');
    expect(outputLine?.level).toBe('info');
  });

  it('fails in the background when a runner step fails (failed status)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        recipe: validRecipe([
          { action: 'download', url: 'http://127.0.0.1:1/missing.bin', dest: 'x.bin' },
        ]),
      }),
    });
    // Accepted (validation OK) — the download failure is a RUNNER failure
    expect(res.statusCode).toBe(202);

    const status = await waitForInstall(app, SERVER_ID, auth);
    expect(status.status).toBe('failed');
    expect(status.error).toContain('Étape 1');
  });

  it('after install: GET 200 stopped, action 404/400, command 409 without a process', async () => {
    // Install a valid server and wait for completion
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    // GET: known server → 200, stopped status
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');

    // Action on unknown server → 404
    const action404 = await app.inject({
      method: 'POST',
      url: `/servers/${OTHER_ID}/action`,
      headers: auth,
      payload: { action: 'start' },
    });
    expect(action404.statusCode).toBe(404);

    // Invalid action → 400
    const action400 = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/action`,
      headers: auth,
      payload: { action: 'explode' },
    });
    expect(action400.statusCode).toBe(400);

    // Console command without a running process → 409
    const cmd = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/command`,
      headers: auth,
      payload: { command: 'say hi' },
    });
    expect(cmd.statusCode).toBe(409);

    // The server list contains the installed server
    const list = await app.inject({ method: 'GET', url: '/servers', headers: auth });
    expect(list.statusCode).toBe(200);
    const ids = list.json().servers.map((s: { serverId: string }) => s.serverId);
    expect(ids).toContain(SERVER_ID);
  });

  it('DELETE: 404 for unknown, removes store + folder, GET → 404 afterwards', async () => {
    const { access } = await import('node:fs/promises');

    // DELETE on an unknown server → 404
    const del404 = await app.inject({
      method: 'DELETE',
      url: `/servers/${OTHER_ID}`,
      headers: auth,
    });
    expect(del404.statusCode).toBe(404);

    // Install a server (and wait for completion)
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    // The folder exists
    await expect(access(join(config.dataDir, 'srv', 'marker.txt'))).resolves.toBeUndefined();

    // DELETE → 200, folder removed (installDir under dataDir)
    const del = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);
    await expect(access(join(config.dataDir, 'srv'))).rejects.toThrow();

    // The server is no longer known
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(404);

    // DELETE again → 404
    const again = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
  });

  it('DELETE: 409 while the process runs, 200 after kill', async () => {
    // Install a server with a long-running process
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({
        recipe: {
          ...validRecipe(),
          start: { command: `"${process.execPath}" -e "setInterval(() => {}, 1000);"` },
        },
      }),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    // Start the process
    const start = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/action`,
      headers: auth,
      payload: { action: 'start' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe('running');

    // DELETE while running → 409
    const del409 = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(del409.statusCode).toBe(409);

    // Kill then DELETE → 200
    const kill = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/action`,
      headers: auth,
      payload: { action: 'kill' },
    });
    expect(kill.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);
  });

  it('GET /servers/:id/logs: 404 for unknown, incremental lines after install', async () => {
    // Unknown server → 404
    const unknown = await app.inject({
      method: 'GET',
      url: `/servers/${OTHER_ID}/logs`,
      headers: auth,
    });
    expect(unknown.statusCode).toBe(404);

    // Install (and wait for completion)
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody(),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    // Logs without a process → empty, next=0
    const logs = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/logs?after=0`,
      headers: auth,
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().lines).toEqual([]);
    expect(logs.json().next).toBe(0);
    expect(logs.json().status).toBe('stopped');
  });

  it('a relative installDir is resolved under the agent dataDir', async () => {
    // A relative "rel-check" installDir must land under config.dataDir
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody({ installDir: 'rel-check' }),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    const { access } = await import('node:fs/promises');
    await expect(access(join(config.dataDir, 'rel-check', 'marker.txt'))).resolves.toBeUndefined();

    // Cleanup
    const del = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true); // under dataDir → removed
  });
});

// ─── POST /servers/:serverId/reinstall route (background) ─────────────────────

describe('Agent API — POST /servers/:serverId/reinstall', () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

  const recipeWithContent = (content: string) => ({
    schemaVersion: 2,
    id: 'test-recipe',
    name: 'Test',
    author: 'me',
    variables: [{ env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 }],
    install: [{ action: 'write', file: 'marker.txt', content }],
    start: { command: 'echo {{SERVER_PORT}}' },
  });

  const installBody = (content: string) => ({
    serverId: SERVER_ID,
    name: 'my-server',
    recipe: recipeWithContent(content),
    variables: {},
    installDir: join(config.dataDir, 'srv'),
    allocation: { port: 25565, memoryMb: 2048 },
  });

  const reinstallBody = (overrides: Record<string, unknown> = {}) => ({
    recipe: recipeWithContent('reinstalled-port={{SERVER_PORT}}'),
    variables: {},
    ...overrides,
  });

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();
  });

  afterAll(async () => {
    // Cleanup: delete the installed server
    await app.inject({ method: 'DELETE', url: `/servers/${SERVER_ID}`, headers: auth });
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/reinstall`,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${OTHER_ID}/reinstall`,
      headers: auth,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('returns 400 when the recipe is invalid', async () => {
    // Install first so the server is known (404 would mask the 400)
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody('port={{SERVER_PORT}}'),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/reinstall`,
      headers: auth,
      payload: reinstallBody({ recipe: { foo: 'bar' } }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Recette invalide');
  });

  it('reinstalls in the background: re-runs the runner, installing status then stopped', async () => {
    // Install v1 → marker = port=25565
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: installBody('port={{SERVER_PORT}}'),
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID, auth);

    const { readFile } = await import('node:fs/promises');
    const markerPath = join(config.dataDir, 'srv', 'marker.txt');
    expect(await readFile(markerPath, 'utf-8')).toBe('port=25565');

    // Reinstall with a NEW recipe version (different install content) — 202,
    // the runner re-runs in the background
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/reinstall`,
      headers: auth,
      payload: reinstallBody(),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('installing');

    const status = await waitForInstall(app, SERVER_ID, auth);
    expect(status.status).toBe('installed');

    // The runner re-ran in the SAME installDir with the STORED allocation
    expect(await readFile(markerPath, 'utf-8')).toBe('reinstalled-port=25565');

    // The store kept the server (with the updated recipe)
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');
  });

  it('fails in the background when a runner step fails (store unchanged)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/reinstall`,
      headers: auth,
      payload: reinstallBody({
        recipe: {
          ...recipeWithContent('x'),
          install: [
            { action: 'download', url: 'http://127.0.0.1:1/missing.bin', dest: 'x.bin' },
          ],
        },
      }),
    });
    expect(res.statusCode).toBe(202);

    const status = await waitForInstall(app, SERVER_ID, auth);
    expect(status.status).toBe('failed');
    expect(status.error).toContain('Étape 1');

    // The server is still known and stopped (store untouched)
    const info = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}`,
      headers: auth,
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().status).toBe('stopped');
  });
});

describe('Agent API — POST /servers/:serverId/variables', () => {
  const VARS_ID = '770e8400-e29b-41d4-a716-446655440000';
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

  const varsRecipe = () => ({
    schemaVersion: 2,
    id: 'vars-recipe',
    name: 'Vars',
    author: 'me',
    variables: [
      { env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 },
      {
        env: 'GAME_VERSION',
        name: 'Version',
        type: 'string',
        defaultValue: '1.21',
        pattern: '^\\d+\\.\\d+(\\.\\d+)?$',
      },
    ],
    install: [{ action: 'write', file: 'marker.txt', content: 'v' }],
    start: { command: 'echo {{GAME_VERSION}}' },
  });

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();

    // Install a server with an initial variable override
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: {
        serverId: VARS_ID,
        name: 'vars-server',
        recipe: varsRecipe(),
        variables: { RAM_MB: 2048 },
        installDir: join(config.dataDir, 'vars-srv'),
        allocation: { port: 25566, memoryMb: 2048 },
      },
    });
    expect(res.statusCode).toBe(202);
    const status = await waitForInstall(app, VARS_ID, auth);
    expect(status.status).toBe('installed');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${VARS_ID}/variables`,
      payload: { variables: { GAME_VERSION: '1.20' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${OTHER_ID}/variables`,
      headers: auth,
      payload: { variables: { GAME_VERSION: '1.20' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the request is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${VARS_ID}/variables`,
      headers: auth,
      payload: { variables: 'not-a-record' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Requête invalide');
  });

  it('returns 422 when a value violates the recipe rules', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${VARS_ID}/variables`,
      headers: auth,
      payload: { variables: { RAM_MB: 'not-a-number' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('RAM');
  });

  it('returns 422 when a value does not match the recipe regex', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${VARS_ID}/variables`,
      headers: auth,
      payload: { variables: { GAME_VERSION: 'latest' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('Version');
  });

  it('updates the requested variable and preserves the others (merge)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${VARS_ID}/variables`,
      headers: auth,
      payload: { variables: { GAME_VERSION: '1.20.4' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.serverId).toBe(VARS_ID);
    // The untouched override survives, the edited one is applied
    expect(body.variables.RAM_MB).toBe(2048);
    expect(body.variables.GAME_VERSION).toBe('1.20.4');
  });
});

// ─── POST /servers/:serverId/allocation route (panel "Network" page) ─────────

describe('Agent API — POST /servers/:serverId/allocation', () => {
  const ALLOC_ID = '880e8400-e29b-41d4-a716-446655440000';
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${TEST_TOKEN}` };

  const allocRecipe = () => ({
    schemaVersion: 2,
    id: 'alloc-recipe',
    name: 'Alloc',
    author: 'me',
    variables: [],
    install: [{ action: 'write', file: 'marker.txt', content: 'p={{SERVER_PORT}}' }],
    start: { command: 'echo {{SERVER_PORT}}' },
  });

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();

    // Install a server with a primary allocation
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: {
        serverId: ALLOC_ID,
        name: 'alloc-server',
        recipe: allocRecipe(),
        variables: {},
        installDir: join(config.dataDir, 'alloc-srv'),
        allocation: { port: 25570, memoryMb: 4096, ip: '10.0.0.5' },
      },
    });
    expect(res.statusCode).toBe(202);
    const status = await waitForInstall(app, ALLOC_ID, auth);
    expect(status.status).toBe('installed');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${ALLOC_ID}/allocation`,
      payload: { allocation: { port: 25571, ip: '10.0.0.5' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${OTHER_ID}/allocation`,
      headers: auth,
      payload: { allocation: { port: 25571, ip: '10.0.0.5' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the request is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${ALLOC_ID}/allocation`,
      headers: auth,
      payload: { allocation: { port: 'not-a-port' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Requête invalide');
  });

  it('updates port/ip and preserves memory (merge)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${ALLOC_ID}/allocation`,
      headers: auth,
      payload: { allocation: { port: 25580, ip: '10.0.0.9' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.serverId).toBe(ALLOC_ID);
    // The new primary port/ip is applied, the memory limit survives
    expect(body.allocation).toEqual({ port: 25580, memoryMb: 4096, ip: '10.0.0.9' });
  });
});
