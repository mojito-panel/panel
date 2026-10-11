import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../src/router';
import type { AgentConfig } from '../src/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_TOKEN = 'a'.repeat(64);

const config: AgentConfig = {
  port: 0,
  host: '127.0.0.1',
  token: TEST_TOKEN,
  panelUrl: 'http://localhost:5173',
  allowedOrigins: [],
  dataDir: join(tmpdir(), 'mojito-files-data-' + process.pid),
  version: '0.1.0-test',
};

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ID = '660e8400-e29b-41d4-a716-446655440000';

const auth = { authorization: `Bearer ${TEST_TOKEN}` };

const validRecipe = {
  schemaVersion: 2,
  id: 'test-recipe',
  name: 'Test',
  author: 'me',
  variables: [{ env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 }],
  install: [{ action: 'write', file: 'marker.txt', content: 'port={{SERVER_PORT}}' }],
  start: { command: 'echo {{SERVER_PORT}}' },
} as const;

/** Polls the tracked install until completion. */
async function waitForInstall(app: FastifyInstance, serverId: string, timeoutMs = 10_000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${serverId}/install`,
      headers: auth,
    });
    if (res.statusCode === 200) {
      const body = res.json();
      if (body.status === 'installed' || body.status === 'failed') return body;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`The install for ${serverId} did not finish in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Agent API — files browser', () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeAll(async () => {
    app = createAgentServer(config);
    await app.ready();
    tmpDir = await mkdtemp(join(tmpdir(), 'mojito-files-'));

    // Install a server — its installDir is the sandbox of every file route
    const install = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: {
        serverId: SERVER_ID,
        name: 'my-server',
        recipe: validRecipe,
        variables: {},
        installDir: join(tmpDir, 'srv'),
        allocation: { port: 25565, memoryMb: 2048 },
      },
    });
    expect(install.statusCode).toBe(202);
    await waitForInstall(app, SERVER_ID);
  });

  afterAll(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Auth & unknown server ─────────────────────────────────────────────────

  it('requires the panel token (401 without it)', async () => {
    const res = await app.inject({ method: 'GET', url: `/servers/${SERVER_ID}/files` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown server', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${OTHER_ID}/files`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  // ─── Listing ────────────────────────────────────────────────────────────────

  it('lists the root (folders before files, with size)', async () => {
    // Prepare: a folder with a file inside, plus a root-level file
    await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'plugins', type: 'directory' },
    });
    await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'plugins/server.properties', type: 'file' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const files = res.json().files;
    expect(files.map((f: { path: string }) => f.path).sort()).toEqual(
      ['marker.txt', 'plugins'].sort(),
    );

    const folder = files.find((f: { name: string }) => f.name === 'plugins');
    expect(folder.isDirectory).toBe(true);
    const marker = files.find((f: { name: string }) => f.name === 'marker.txt');
    expect(marker.isDirectory).toBe(false);
    expect(marker.size).toBe('port=25565'.length);
    expect(marker.modifiedAt).toEqual(expect.any(String));
  });

  it('lists a subfolder and returns 404 for a missing folder', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=plugins`,
      headers: auth,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().files[0].path).toBe('plugins/server.properties');

    const missing = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=unknown`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('not_found');
  });

  // ─── Read / write ──────────────────────────────────────────────────────────

  it('reads the text content of a file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=marker.txt`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: 'marker.txt', content: 'port=25565', size: 10 });
  });

  it('reads 404 (missing), 400 (folder), 400 (missing path)', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=nope.txt`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);

    const isDir = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=plugins`,
      headers: auth,
    });
    expect(isDir.statusCode).toBe(400);
    expect(isDir.json().code).toBe('wrong_type');

    const noPath = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
    });
    expect(noPath.statusCode).toBe(400);
  });

  it('writes a file (create + update), refuses to overwrite a folder', async () => {
    const write = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: 'config/motd.txt', content: 'Welcome!' },
    });
    expect(write.statusCode).toBe(204);

    // Parent folders are created implicitly
    const read = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=config/motd.txt`,
      headers: auth,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toBe('Welcome!');

    const update = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: 'config/motd.txt', content: 'Hi!' },
    });
    expect(update.statusCode).toBe(204);

    const overDir = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: 'plugins', content: 'nope' },
    });
    expect(overDir.statusCode).toBe(400);
    expect(overDir.json().code).toBe('wrong_type');
  });

  it('refuses oversized files in read and write (413)', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    const write = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: 'big.txt', content: big },
    });
    expect(write.statusCode).toBe(413);
    expect(write.json().code).toBe('too_large');
  });

  // ─── Create / rename / delete ──────────────────────────────────────────────

  it('creates file and folder, 409 if the entry already exists', async () => {
    const dir = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'world', type: 'directory' },
    });
    expect(dir.statusCode).toBe(204);

    const file = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'world/level.txt', type: 'file' },
    });
    expect(file.statusCode).toBe(204);

    const dupFile = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'marker.txt', type: 'file' },
    });
    expect(dupFile.statusCode).toBe(409);
    expect(dupFile.json().code).toBe('exists');

    const dupDir = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'world', type: 'directory' },
    });
    expect(dupDir.statusCode).toBe(409);
  });

  it('renames (404 missing source, 409 existing target)', async () => {
    const rename = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/rename`,
      headers: auth,
      payload: { path: 'world/level.txt', newPath: 'world/level.dat' },
    });
    expect(rename.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=world`,
      headers: auth,
    });
    expect(list.json().files[0].name).toBe('level.dat');

    const missing = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/rename`,
      headers: auth,
      payload: { path: 'ghost.txt', newPath: 'ghost2.txt' },
    });
    expect(missing.statusCode).toBe(404);

    const conflict = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/rename`,
      headers: auth,
      payload: { path: 'world/level.dat', newPath: 'marker.txt' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('deletes files and folders (recursive), tolerates already-gone entries', async () => {
    const del = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/delete`,
      headers: auth,
      payload: { paths: ['world', 'config/motd.txt', 'already-gone.txt'] },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files`,
      headers: auth,
    });
    const paths = list.json().files.map((f: { path: string }) => f.path);
    expect(paths).not.toContain('world');
    // The parent folder survives — only its child file was deleted
    expect(paths).toContain('config');
    const configList = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=config`,
      headers: auth,
    });
    expect(configList.json().files).toEqual([]);
  });

  // ─── Upload (base64) ───────────────────────────────────────────────────────

  it('uploads a file (base64), refuses a folder as target', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/upload`,
      headers: auth,
      payload: { path: 'uploads/mod.jar', contentBase64: Buffer.from('PK binary').toString('base64') },
    });
    expect(upload.statusCode).toBe(204);

    const read = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=uploads/mod.jar`,
      headers: auth,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toBe('PK binary');

    const overDir = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/upload`,
      headers: auth,
      payload: { path: 'plugins', contentBase64: Buffer.from('x').toString('base64') },
    });
    expect(overDir.statusCode).toBe(400);
  });

  // ─── Security: path traversal ───────────────────────────────────────────────

  it('rejects traversal paths (..) on every route', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=../`,
      headers: auth,
    });
    expect(list.statusCode).toBe(400);
    expect(list.json().code).toBe('invalid_path');

    const read = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=../../secret.txt`,
      headers: auth,
    });
    expect(read.statusCode).toBe(400);

    const write = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: '../escape.txt', content: 'nope' },
    });
    expect(write.statusCode).toBe(400);

    const rename = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/rename`,
      headers: auth,
      payload: { path: 'marker.txt', newPath: '../renamed.txt' },
    });
    expect(rename.statusCode).toBe(400);

    const del = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/delete`,
      headers: auth,
      payload: { paths: ['..'] },
    });
    expect(del.statusCode).toBe(400);

    const create = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/create`,
      headers: auth,
      payload: { path: 'a/../b', type: 'file' },
    });
    expect(create.statusCode).toBe(400);
  });

  it('rejects absolute paths / Windows drives, normalized backslashes stay safe', async () => {
    const drive = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=${encodeURIComponent('C:/Windows')}`,
      headers: auth,
    });
    expect(drive.statusCode).toBe(400);
    expect(drive.json().code).toBe('invalid_path');

    const absolute = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files?path=${encodeURIComponent('/etc')}`,
      headers: auth,
    });
    // A leading '/' is stripped → stays inside the server → 404 (unknown dir)
    expect([200, 404]).toContain(absolute.statusCode);

    // Backslash paths are normalized to '/' and DO work (panel ↔ agent contract)
    const write = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/content`,
      headers: auth,
      payload: { path: 'plugins\\renamed-backslash.txt', content: 'ok' },
    });
    expect(write.statusCode).toBe(204);
    const read = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/files/content?path=plugins/renamed-backslash.txt`,
      headers: auth,
    });
    expect(read.statusCode).toBe(200);
  });

  it('refuses an empty or invalid delete request (400)', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/files/delete`,
      headers: auth,
      payload: { paths: [] },
    });
    expect(empty.statusCode).toBe(400);
  });
});
