import { MikroORM } from '@mikro-orm/sqlite';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Registry,
  RegistryEntry,
  SshKey,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
  Backup,
  Setting,
  ActivityLog,
  Schedule,
  ScheduleTask,
} from '~/db/entities';

/**
 * MikroORM integration tests — checks that the entity schema
 * (better-auth + business) is created correctly in SQLite in-memory.
 */
describe('MikroORM entities (SQLite in-memory)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [
        User,
        Session,
        Account,
        Verification,
        Node,
        Recipe,
        Registry,
        RegistryEntry,
        SshKey,
        Server,
        Allocation,
        ServerUser,
        PanelRole,
        Backup,
        Setting,
        ActivityLog,
        Schedule,
        ScheduleTask,
      ],
    });
    await orm.schema.create();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('creates all tables', async () => {
    const tables = await orm.em
      .getConnection()
      .execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const tableNames = tables.map((t) => (t as { name: string }).name);
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('node');
    expect(tableNames).toContain('recipe');
    expect(tableNames).toContain('server');
    expect(tableNames).toContain('allocation');
    expect(tableNames).toContain('server_user');
    expect(tableNames).toContain('role');
    expect(tableNames).toContain('backup');
    expect(tableNames).toContain('setting');
    expect(tableNames).toContain('registry');
    expect(tableNames).toContain('registry_entry');
    expect(tableNames).toContain('ssh_key');
    expect(tableNames).toContain('activity_log');
    expect(tableNames).toContain('schedule');
    expect(tableNames).toContain('schedule_task');
  });

  it('creates a User with the default role', async () => {
    const em = orm.em.fork();
    const user = em.create(User, {
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      emailVerified: false,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(user);
    await em.flush();

    const found = await em.findOne(User, { email: 'admin@example.com' });
    expect(found).not.toBeNull();
    expect(found?.role).toBe('admin');
  });

  it('creates a Node', async () => {
    const em = orm.em.fork();
    const node = em.create(Node, {
      id: 'node-1',
      name: 'Windows-01',
      fqdn: 'node1.example.com',
      agentPort: 8080,
      agentToken: 'secret-token-32-bytes-minimum',
      lastSeenAt: null,
      status: 'unknown',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(node);
    await em.flush();

    const found = await em.findOne(Node, { fqdn: 'node1.example.com' });
    expect(found?.name).toBe('Windows-01');
    expect(found?.agentPort).toBe(8080);
    expect(found?.agentToken).toBe('secret-token-32-bytes-minimum');
  });

  it('creates a Recipe with JSON', async () => {
    const em = orm.em.fork();
    const recipe = em.create(Recipe, {
      id: 'recipe-1',
      slug: 'minecraft-vanilla',
      name: 'Minecraft Vanilla',
      schemaVersion: 1,
      json: { id: 'minecraft-vanilla', variables: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(recipe);
    await em.flush();

    const found = await em.findOne(Recipe, { slug: 'minecraft-vanilla' });
    expect(found?.json).toMatchObject({ id: 'minecraft-vanilla' });
  });

  it('creates a Server with JSON variables and the default status', async () => {
    const em = orm.em.fork();
    const server = em.create(Server, {
      id: 'server-1',
      name: 'My MC server',
      nodeId: 'node-1',
      recipeId: 'recipe-1',
      ownerId: 'user-1',
      status: 'stopped',
      variables: { ram_mb: 2048, motd: 'Hello' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(server);
    await em.flush();

    const found = await em.findOne(Server, { id: 'server-1' });
    expect(found?.status).toBe('stopped');
    expect(found?.memoryMb).toBe(2048); // default
    expect(found?.backupLimit).toBe(5); // default
    expect(found?.variables).toMatchObject({ ram_mb: 2048 });
  });

  it('creates a Backup row with the default status and size', async () => {
    const em = orm.em.fork();
    const backup = em.create(Backup, {
      id: '9d8b0f6e-2c4a-4e8f-9a3b-5c7d1e2f3a4b',
      serverId: 'server-1',
      name: 'Before the update',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(backup);
    await em.flush();

    const found = await em.findOne(Backup, { serverId: 'server-1' });
    expect(found?.status).toBe('pending'); // default
    expect(found?.sizeBytes).toBe(0); // default
    expect(found?.checksum).toBeNull();
    expect(found?.completedAt).toBeNull();
  });

  it('creates a free Allocation then assigns it to a server', async () => {
    const em = orm.em.fork();
    const alloc = em.create(Allocation, {
      id: 'alloc-1',
      nodeId: 'node-1',
      serverId: null,
      ip: '0.0.0.0',
      port: 25565,
      alias: null,
      primary: false,
      createdAt: new Date(),
    });
    em.persist(alloc);
    await em.flush();

    const free = await em.findOne(Allocation, { id: 'alloc-1' });
    expect(free?.port).toBe(25565);
    expect(free?.serverId).toBeNull();
    expect(free?.primary).toBe(false);

    free!.serverId = 'server-1';
    free!.primary = true;
    await em.flush();

    const assigned = await em.findOne(Allocation, { serverId: 'server-1' });
    expect(assigned?.primary).toBe(true);
  });

  it('creates a ServerUser grant with a JSON permission map', async () => {
    const em = orm.em.fork();
    const grant = em.create(ServerUser, {
      id: 'server-user-1',
      serverId: 'server-1',
      userId: 'user-1',
      permissions: { 'server.console': ['read', 'command'], 'server.files': ['read'] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(grant);
    await em.flush();

    const found = await em.findOne(ServerUser, { serverId: 'server-1', userId: 'user-1' });
    expect(found?.permissions).toMatchObject({
      'server.console': ['read', 'command'],
      'server.files': ['read'],
    });
  });

  it('creates a custom PanelRole with a JSON permission map', async () => {
    const em = orm.em.fork();
    const role = em.create(PanelRole, {
      id: 'support',
      name: 'Support',
      description: 'Équipe support — lecture seule',
      permissions: { 'panel.overview': ['read'], user: ['list'] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(role);
    await em.flush();

    const found = await em.findOne(PanelRole, { id: 'support' });
    expect(found?.name).toBe('Support');
    expect(found?.permissions).toMatchObject({ user: ['list'] });

    // The unique name constraint holds
    const clash = em.create(PanelRole, {
      id: 'support-2',
      name: 'Support',
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(clash);
    await expect(em.flush()).rejects.toThrow();
  });

  it('creates a suspended User (admin plugin columns)', async () => {
    const em = orm.em.fork();
    const user = em.create(User, {
      id: 'user-2',
      name: 'Suspended',
      email: 'suspended@example.com',
      emailVerified: false,
      role: 'user',
      banned: true,
      banReason: 'Test suspension',
      banExpires: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(user);
    await em.flush();

    const found = await em.findOne(User, { email: 'suspended@example.com' });
    expect(found?.banned).toBe(true);
    expect(found?.banReason).toBe('Test suspension');
    // Default: an account is NOT banned
    const admin = await em.findOne(User, { email: 'admin@example.com' });
    expect(admin?.banned).toBe(false);
  });

  it('creates a Session linked to a User', async () => {
    const em = orm.em.fork();
    const session = em.create(Session, {
      id: 'session-1',
      expiresAt: new Date(Date.now() + 86400000),
      token: 'tok_abc',
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'user-1',
    });
    em.persist(session);
    await em.flush();

    const found = await em.findOne(Session, { token: 'tok_abc' });
    expect(found?.userId).toBe('user-1');
  });

  it('creates a Registry with its sync bookkeeping', async () => {
    const em = orm.em.fork();
    const registry = em.create(Registry, {
      id: 'registry-1',
      name: 'Mojito recipes',
      url: 'https://github.com/mojito/recipes',
      branch: '',
      branchName: 'main',
      headSha: 'abc123',
      lastSyncedAt: new Date(),
      lastError: null,
      sshKeyId: null,
      cover: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(registry);
    await em.flush();

    const found = await em.findOne(Registry, { id: 'registry-1' });
    expect(found?.name).toBe('Mojito recipes');
    expect(found?.branchName).toBe('main');
    expect(found?.lastError).toBeNull();
  });

  it('creates a RegistryEntry catalog row (light columns + content)', async () => {
    const em = orm.em.fork();
    const entry = em.create(RegistryEntry, {
      id: 'entry-1',
      registryId: 'registry-1',
      path: 'steamcmd/minecraft/recipe-minecraft.json',
      sha: 'deadbeef',
      slug: 'minecraft',
      name: 'Minecraft',
      type: null,
      description: null,
      error: null,
      cover: null,
      content: '{"schema_version":4}',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(entry);
    await em.flush();

    const found = await em.findOne(RegistryEntry, { registryId: 'registry-1' });
    expect(found?.slug).toBe('minecraft');
    expect(found?.content).toBe('{"schema_version":4}');
  });

  it('creates an SshKey with its fingerprint', async () => {
    const em = orm.em.fork();
    const key = em.create(SshKey, {
      id: 'key-1',
      name: 'Deploy key',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample deploy@panel',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      fingerprint: 'SHA256:abc123',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(key);
    await em.flush();

    const found = await em.findOne(SshKey, { id: 'key-1' });
    expect(found?.name).toBe('Deploy key');
    expect(found?.fingerprint).toBe('SHA256:abc123');
  });

  it('creates an ActivityLog row with its denormalized actor snapshot', async () => {
    const em = orm.em.fork();
    const log = em.create(ActivityLog, {
      id: 'activity-1',
      event: 'server:power',
      description: 'Action « start » sur « My MC server »',
      ip: '203.0.113.10',
      userAgent: 'vitest',
      actorId: 'user-1',
      actorName: 'Admin',
      actorEmail: 'admin@example.com',
      serverId: 'server-1',
      serverName: 'My MC server',
      properties: { action: 'start' },
      createdAt: new Date(),
    });
    em.persist(log);
    await em.flush();

    const found = await em.findOne(ActivityLog, { event: 'server:power' });
    expect(found?.actorEmail).toBe('admin@example.com');
    expect(found?.properties).toMatchObject({ action: 'start' });
  });

  it('creates a Schedule with its task chain', async () => {
    const em = orm.em.fork();
    const schedule = em.create(Schedule, {
      id: 'schedule-1',
      serverId: 'server-1',
      name: 'Nightly restart',
      cron: '30 4 * * *',
      timezone: 'Europe/Paris',
      isActive: true,
      isProcessing: false,
      onlyWhenOnline: false,
      lastRunAt: null,
      nextRunAt: new Date('2030-01-01T04:30:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(schedule);

    const task = em.create(ScheduleTask, {
      id: 'task-1',
      scheduleId: 'schedule-1',
      sequenceId: 1,
      action: 'power',
      payload: 'restart',
      timeOffset: 0,
      continueOnFailure: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(task);
    await em.flush();

    const found = await em.findOne(Schedule, { id: 'schedule-1' });
    expect(found?.cron).toBe('30 4 * * *');
    expect(found?.isProcessing).toBe(false);

    const tasks = await em.find(ScheduleTask, { scheduleId: 'schedule-1' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.payload).toBe('restart');
  });

  it('generates nanoid ids at em.create() time via onCreate (no explicit id)', async () => {
    const em = orm.em.fork();
    const schedule = em.create(Schedule, {
      serverId: 'server-1',
      name: 'Auto id',
      cron: '0 5 * * *',
      updatedAt: new Date(),
    });
    // onCreate runs inside em.create() (processOnCreateHooksEarly), BEFORE any
    // flush — services rely on entity.id being available immediately.
    expect(schedule.id).toMatch(/^[A-Za-z0-9_-]{21}$/);

    const task = em.create(ScheduleTask, {
      scheduleId: schedule.id,
      sequenceId: 1,
      action: 'command',
      payload: 'say hi',
      updatedAt: new Date(),
    });
    expect(task.id).toMatch(/^[A-Za-z0-9_-]{21}$/);

    em.persist(schedule);
    em.persist(task);
    await em.flush();

    const found = await em.findOne(Schedule, { id: schedule.id });
    expect(found?.name).toBe('Auto id');
    const tasks = await em.find(ScheduleTask, { scheduleId: schedule.id });
    expect(tasks).toHaveLength(1);
  });
});
