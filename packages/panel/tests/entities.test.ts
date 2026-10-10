import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/sqlite';
import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Plugin,
  Server,
  ServerAllocation,
} from '~/db/entities';

/**
 * Tests d'intégration MikroORM — vérifie que le schéma des entités
 * (better-auth + métier) se crée correctement en SQLite in-memory.
 */
describe('MikroORM entities (SQLite in-memory)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [User, Session, Account, Verification, Node, Plugin, Server, ServerAllocation],
    });
    await orm.schema.create();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('crée toutes les tables', async () => {
    const tables = await orm.em.getConnection().execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = tables.map((t: { name: string }) => t.name);
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('node');
    expect(tableNames).toContain('plugin');
    expect(tableNames).toContain('server');
    expect(tableNames).toContain('server_allocation');
  });

  it('crée un User avec le rôle par défaut', async () => {
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

  it('crée un Node', async () => {
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

  it('crée un Plugin avec du JSON', async () => {
    const em = orm.em.fork();
    const plugin = em.create(Plugin, {
      id: 'plugin-1',
      slug: 'minecraft-vanilla',
      name: 'Minecraft Vanilla',
      schemaVersion: 1,
      json: { id: 'minecraft-vanilla', variables: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(plugin);
    await em.flush();

    const found = await em.findOne(Plugin, { slug: 'minecraft-vanilla' });
    expect(found?.json).toMatchObject({ id: 'minecraft-vanilla' });
  });

  it('crée un Server avec variables JSON et statut par défaut', async () => {
    const em = orm.em.fork();
    const server = em.create(Server, {
      id: 'server-1',
      name: 'Mon serveur MC',
      nodeId: 'node-1',
      pluginId: 'plugin-1',
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
    expect(found?.variables).toMatchObject({ ram_mb: 2048 });
  });

  it('crée une ServerAllocation', async () => {
    const em = orm.em.fork();
    const alloc = em.create(ServerAllocation, {
      id: 'alloc-1',
      serverId: 'server-1',
      port: 25565,
      maxRamMb: 4096,
      maxCpuPercent: 100,
      createdAt: new Date(),
    });
    em.persist(alloc);
    await em.flush();

    const found = await em.findOne(ServerAllocation, { serverId: 'server-1' });
    expect(found?.port).toBe(25565);
    expect(found?.maxRamMb).toBe(4096);
  });

  it('crée une Session liée à un User', async () => {
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
});
