import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentServer } from '../src/router';
import type { AgentConfig } from '../src/config';
import {
  expandBackupEntries,
  createBackupArchive,
  restoreBackupArchive,
  removeBackupArchive,
  backupArchiveExists,
  BackupError,
} from '../src/server/backup/service';
import { BackupRegistry } from '../src/server/backup/registry';

const TEST_TOKEN = 'b'.repeat(64);

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';
const BACKUP_ID = '770e8400-e29b-41d4-a716-446655440000';
const OTHER_BACKUP_ID = '880e8400-e29b-41d4-a716-446655440000';

const auth = { authorization: `Bearer ${TEST_TOKEN}` };

// ─── Service unit tests (temp dirs, no HTTP) ─────────────────────────────────

describe('backup service (glob expansion + tar round-trip)', () => {
  let installDir: string;
  let backupDir: string;

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'mojito-backup-'));
    installDir = join(base, 'server');
    backupDir = join(base, 'backups');
    await mkdir(join(installDir, 'world', 'sub'), { recursive: true });
    await mkdir(join(installDir, 'logs'), { recursive: true });
    await mkdir(join(installDir, '.bin'), { recursive: true });
    await writeFile(join(installDir, 'server.jar'), 'jar-bytes');
    await writeFile(join(installDir, 'server.properties'), 'port=25565');
    await writeFile(join(installDir, 'world', 'level.dat'), 'level');
    await writeFile(join(installDir, 'world', 'sub', 'deep.dat'), 'deep');
    await writeFile(join(installDir, 'logs', 'latest.log'), 'log');
    await writeFile(join(installDir, '.bin', 'java.exe'), 'fake-jdk');
  });

  afterEach(async () => {
    await rm(join(installDir, '..'), { recursive: true, force: true });
  });

  describe('expandBackupEntries (include patterns)', () => {
    it('defaults to the whole install dir, excluding .bin', async () => {
      const entries = await expandBackupEntries(installDir);
      expect(entries).toContain('server.jar');
      expect(entries).toContain('world');
      expect(entries).toContain('logs');
      expect(entries.some((e) => e === '.bin' || e.startsWith('.bin/'))).toBe(false);
    });

    it('expands an explicit directory include to a single entry point', async () => {
      const entries = await expandBackupEntries(installDir, ['world']);
      expect(entries).toEqual(['world']);
    });

    it('expands glob metacharacters', async () => {
      const entries = await expandBackupEntries(installDir, ['*.jar', 'world/*.dat']);
      expect(entries.sort()).toEqual(['server.jar', 'world/level.dat']);
    });

    it('drops children already covered by a matched directory', async () => {
      const entries = await expandBackupEntries(installDir, ['world', 'world/level.dat']);
      expect(entries).toEqual(['world']);
    });

    it('rejects an include matching nothing', async () => {
      await expect(expandBackupEntries(installDir, ['unknown/**'])).rejects.toThrow(BackupError);
    });

    it('rejects escape patterns and .bin', async () => {
      await expect(expandBackupEntries(installDir, ['../outside'])).rejects.toThrow(BackupError);
      await expect(expandBackupEntries(installDir, ['.bin'])).rejects.toThrow(BackupError);
      await expect(expandBackupEntries(installDir, ['.bin/**'])).rejects.toThrow(BackupError);
    });
  });

  describe('create + restore round-trip', () => {
    it('creates a tar.gz with size and sha-256 checksum', async () => {
      const result = await createBackupArchive({
        installDir,
        backupDir,
        serverId: SERVER_ID,
        backupId: BACKUP_ID,
      });
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(await backupArchiveExists(backupDir, SERVER_ID, BACKUP_ID)).toBe(true);
    });

    it('restores with truncate: archive content back, other files wiped, .bin preserved', async () => {
      await createBackupArchive({
        installDir,
        backupDir,
        serverId: SERVER_ID,
        backupId: BACKUP_ID,
        include: ['world', 'server.jar'],
      });

      // Simulate drift: remove an archived file, add a stray one
      await rm(join(installDir, 'world'), { recursive: true, force: true });
      await writeFile(join(installDir, 'stray.txt'), 'stray');

      await restoreBackupArchive({
        installDir,
        backupDir,
        serverId: SERVER_ID,
        backupId: BACKUP_ID,
        truncate: true,
      });

      expect(await readFile(join(installDir, 'world', 'level.dat'), 'utf-8')).toBe('level');
      expect(await readFile(join(installDir, 'server.jar'), 'utf-8')).toBe('jar-bytes');
      // The stray file is gone, the agent tool dir survives
      await expect(access(join(installDir, 'stray.txt'))).rejects.toThrow();
      await expect(access(join(installDir, 'logs'))).rejects.toThrow();
      expect(await readFile(join(installDir, '.bin', 'java.exe'), 'utf-8')).toBe('fake-jdk');
    });

    it('restores without truncate: files are merged, others stay', async () => {
      await createBackupArchive({
        installDir,
        backupDir,
        serverId: SERVER_ID,
        backupId: BACKUP_ID,
        include: ['world'],
      });
      await restoreBackupArchive({
        installDir,
        backupDir,
        serverId: SERVER_ID,
        backupId: BACKUP_ID,
        truncate: false,
      });
      // logs/ was not in the archive but survives the merge restore
      expect(await readFile(join(installDir, 'logs', 'latest.log'), 'utf-8')).toBe('log');
    });

    it('refuses to restore an unknown archive', async () => {
      await expect(
        restoreBackupArchive({
          installDir,
          backupDir,
          serverId: SERVER_ID,
          backupId: OTHER_BACKUP_ID,
          truncate: false,
        }),
      ).rejects.toThrow(BackupError);
    });

    it('refuses to delete a missing archive', async () => {
      await expect(removeBackupArchive(backupDir, SERVER_ID, OTHER_BACKUP_ID)).rejects.toThrow(
        BackupError,
      );
    });
  });

  describe('archive entry safety (tar-slip)', () => {
    /**
     * Builds a minimal uncompressed tar holding one file entry with a
     * HAND-CRAFTED name (e.g. `../evil.txt`) — what an attacker-controlled
     * archive would contain. The restore pre-pass must abort before any
     * file is written outside the install dir.
     */
    function craftTar(entryName: string, content: string): Buffer {
      const header = Buffer.alloc(512);
      header.write(entryName, 0, 100, 'utf-8');
      header.write('0000644\0', 100, 'utf-8'); // mode
      header.write('0000000\0', 108, 'utf-8'); // uid
      header.write('0000000\0', 116, 'utf-8'); // gid
      const size = Buffer.byteLength(content);
      header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'utf-8'); // size
      header.write('00000000000\0', 136, 'utf-8'); // mtime
      header.write('        ', 148, 'utf-8'); // checksum placeholder (spaces)
      header.write('0', 156, 'utf-8'); // typeflag: regular file
      let checksum = 0;
      for (const byte of header) checksum += byte;
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf-8');

      const data = Buffer.alloc(512);
      data.write(content, 0, 'utf-8');
      return Buffer.concat([header, data, Buffer.alloc(1024)]);
    }

    it('aborts a restore whose archive tries to escape the install dir', async () => {
      const malicious = craftTar('../evil.txt', 'pwned');
      await mkdir(join(backupDir, SERVER_ID), { recursive: true });
      await writeFile(
        join(backupDir, SERVER_ID, `${OTHER_BACKUP_ID}.tar.gz`),
        malicious,
      );

      await expect(
        restoreBackupArchive({
          installDir,
          backupDir,
          serverId: SERVER_ID,
          backupId: OTHER_BACKUP_ID,
          truncate: false,
        }),
      ).rejects.toThrow(BackupError);
      await expect(access(join(installDir, '..', 'evil.txt'))).rejects.toThrow();
    });

    it('aborts a restore trying to overwrite .bin', async () => {
      const malicious = craftTar('.bin/java.exe', 'pwned');
      await mkdir(join(backupDir, SERVER_ID), { recursive: true });
      await writeFile(join(backupDir, SERVER_ID, `${OTHER_BACKUP_ID}.tar.gz`), malicious);

      await expect(
        restoreBackupArchive({
          installDir,
          backupDir,
          serverId: SERVER_ID,
          backupId: OTHER_BACKUP_ID,
          truncate: false,
        }),
      ).rejects.toThrow(BackupError);
      expect(await readFile(join(installDir, '.bin', 'java.exe'), 'utf-8')).toBe('fake-jdk');
    });
  });
});

// ─── Registry unit tests ─────────────────────────────────────────────────────

describe('BackupRegistry (in-memory operation states)', () => {
  it('starts one operation at a time per server', () => {
    const registry = new BackupRegistry();
    const state = registry.start(SERVER_ID, BACKUP_ID, 'create');
    expect(state?.status).toBe('running');
    expect(registry.isBusy(SERVER_ID)).toBe(true);
    expect(registry.start(SERVER_ID, OTHER_BACKUP_ID, 'create')).toBeNull();
  });

  it('finishes an operation and keeps it pollable', () => {
    const registry = new BackupRegistry();
    registry.start(SERVER_ID, BACKUP_ID, 'create');
    registry.finish(SERVER_ID, BACKUP_ID, true, { sizeBytes: 42, checksum: 'abc' });

    expect(registry.isBusy(SERVER_ID)).toBe(false);
    const state = registry.get(SERVER_ID, BACKUP_ID);
    expect(state?.status).toBe('completed');
    expect(state?.sizeBytes).toBe(42);
    expect(state?.checksum).toBe('abc');
  });

  it('records a failure with its error message', () => {
    const registry = new BackupRegistry();
    registry.start(SERVER_ID, BACKUP_ID, 'restore');
    registry.finish(SERVER_ID, BACKUP_ID, false, { error: 'boom' });

    const state = registry.get(SERVER_ID, BACKUP_ID);
    expect(state?.status).toBe('failed');
    expect(state?.error).toBe('boom');
    expect(state?.operation).toBe('restore');
  });

  it('caps the history per server', () => {
    const registry = new BackupRegistry();
    for (let i = 0; i < 12; i++) {
      const id = `id-${i}`;
      registry.start(SERVER_ID, id, 'create');
      registry.finish(SERVER_ID, id, true);
    }
    expect(registry.get(SERVER_ID, 'id-0')).toBeNull();
    expect(registry.get(SERVER_ID, 'id-11')).not.toBeNull();
  });

  it('serializes to the contract status shape', () => {
    const registry = new BackupRegistry();
    const state = registry.start(SERVER_ID, BACKUP_ID, 'create');
    if (!state) throw new Error('start failed');
    const status = registry.toStatus(state);
    expect(status.serverId).toBe(SERVER_ID);
    expect(status.backupId).toBe(BACKUP_ID);
    expect(status.operation).toBe('create');
    expect(status.status).toBe('running');
    expect(status.checksum).toBeNull();
    expect(status.finishedAt).toBeNull();
  });
});

// ─── Route tests (Fastify inject, full agent server) ─────────────────────────

describe('Agent backup routes', () => {
  let app: FastifyInstance;
  let installDir: string;
  const config: AgentConfig = {
    port: 0,
    host: '127.0.0.1',
    token: TEST_TOKEN,
    panelUrl: 'http://localhost:5173',
    allowedOrigins: [],
    dataDir: join(tmpdir(), `mojito-backup-api-${process.pid}`),
    version: '0.1.0-test',
  };

  const recipe = {
    schemaVersion: 2,
    id: 'test-recipe',
    name: 'Test',
    author: 'me',
    variables: [],
    install: [
      { action: 'write', file: 'marker.txt', content: 'port={{SERVER_PORT}}' },
      { action: 'write', file: 'world/level.dat', content: 'level' },
    ],
    start: { command: 'echo {{SERVER_PORT}}' },
  };

  /** Installs the test server and waits for the background install. */
  async function installTestServer(): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/install',
      headers: auth,
      payload: {
        serverId: SERVER_ID,
        name: 'my-server',
        recipe,
        variables: {},
        installDir,
        allocation: { port: 25565, memoryMb: 2048 },
      },
    });
    expect(res.statusCode).toBe(202);

    for (let i = 0; i < 100; i++) {
      const status = await app.inject({
        method: 'GET',
        url: `/servers/${SERVER_ID}/install`,
        headers: auth,
      });
      const body = status.json();
      if (body.status === 'installed' || body.status === 'failed') {
        expect(body.status).toBe('installed');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('the test install did not finish in time');
  }

  /** Polls a backup operation until terminal, returns the final status. */
  async function waitForBackup(
    serverId: string,
    backupId: string,
    timeoutMs = 10_000,
  ): Promise<{ status: string; error: string | null; sizeBytes: number; checksum: string | null }> {
    const startedAt = Date.now();
    for (;;) {
      const res = await app.inject({
        method: 'GET',
        url: `/servers/${serverId}/backups/${backupId}`,
        headers: auth,
      });
      if (res.statusCode === 200) {
        const body = res.json();
        if (body.status === 'completed' || body.status === 'failed') return body;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`the backup operation for ${backupId} did not finish in time`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Signs a backup download JWT exactly like the panel does (HS256, node token). */
  function signDownloadToken(payload: object): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', TEST_TOKEN)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  beforeAll(async () => {
    installDir = join(config.dataDir, 'srv');
    app = createAgentServer(config);
    await app.ready();
    await installTestServer();
  });

  afterAll(async () => {
    await app.close();
    await rm(config.dataDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups`,
      payload: { backupId: BACKUP_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a backup, then reports completion with size and checksum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups`,
      headers: auth,
      payload: { backupId: BACKUP_ID },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('running');

    const status = await waitForBackup(SERVER_ID, BACKUP_ID);
    expect(status.status).toBe('completed');
    expect(status.sizeBytes).toBeGreaterThan(0);
    expect(status.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers 404 for an unknown backup status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${OTHER_BACKUP_ID}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it('answers 404 for an unknown server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/servers/660e8400-e29b-41d4-a716-446655440000/backups',
      headers: auth,
      payload: { backupId: BACKUP_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  it('answers 400 for an escaping include pattern', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups`,
      headers: auth,
      payload: { backupId: '990e8400-e29b-41d4-a716-446655440000', include: ['../secret'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_include');
  });

  it('downloads the archive with the panel token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/download`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('downloads the archive with a valid backup download JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signDownloadToken({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'user-1',
      serverId: SERVER_ID,
      backupId: BACKUP_ID,
      scope: 'backup-download',
      iat: now,
      exp: now + 120,
      jti: 'jti-1',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/download?token=${token}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a download JWT bound to another backup (403)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signDownloadToken({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'user-1',
      serverId: SERVER_ID,
      backupId: OTHER_BACKUP_ID,
      scope: 'backup-download',
      iat: now,
      exp: now + 120,
      jti: 'jti-2',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/download?token=${token}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an expired download JWT (401)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signDownloadToken({
      iss: 'mojito-panel',
      aud: 'mojito-agent',
      sub: 'user-1',
      serverId: SERVER_ID,
      backupId: BACKUP_ID,
      scope: 'backup-download',
      iat: now - 600,
      exp: now - 300,
      jti: 'jti-3',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/download?token=${token}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('restores a backup (merge) — poll to completion', async () => {
    // Drift: remove an archived file before restoring
    await rm(join(installDir, 'world'), { recursive: true, force: true });

    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/restore`,
      headers: auth,
      payload: { truncate: false },
    });
    expect(res.statusCode).toBe(202);

    const status = await waitForBackup(SERVER_ID, BACKUP_ID);
    expect(status.status).toBe('completed');
    expect(await readFile(join(installDir, 'world', 'level.dat'), 'utf-8')).toBe('level');
  });

  it('restores with truncate: wipes the install dir except .bin', async () => {
    await writeFile(join(installDir, 'stray.txt'), 'stray');
    await mkdir(join(installDir, '.bin'), { recursive: true });
    await writeFile(join(installDir, '.bin', 'tool.exe'), 'tool');

    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/restore`,
      headers: auth,
      payload: { truncate: true },
    });
    expect(res.statusCode).toBe(202);

    const status = await waitForBackup(SERVER_ID, BACKUP_ID);
    expect(status.status).toBe('completed');

    const remaining = await readdir(installDir);
    expect(remaining.sort()).toEqual(['.bin', 'marker.txt', 'world']);
    expect(await readFile(join(installDir, '.bin', 'tool.exe'), 'utf-8')).toBe('tool');
  });

  it('answers 404 when restoring an unknown archive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/servers/${SERVER_ID}/backups/${OTHER_BACKUP_ID}/restore`,
      headers: auth,
      payload: { truncate: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('deletes an archive, then answers 404 for it', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(204);

    const download = await app.inject({
      method: 'GET',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}/download`,
      headers: auth,
    });
    expect(download.statusCode).toBe(404);

    const again = await app.inject({
      method: 'DELETE',
      url: `/servers/${SERVER_ID}/backups/${BACKUP_ID}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
  });
});
