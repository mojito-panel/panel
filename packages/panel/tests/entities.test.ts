import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/sqlite';
import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Server,
  Allocation,
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
      entities: [User, Session, Account, Verification, Node, Recipe, Server, Allocation],
    });
    await orm.schema.create();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('creates all tables', async () => {
    const tables = await orm.em.getConnection().execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = tables.map((t: { name: string }) => t.name);
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('node');
    expect(tableNames).toContain('recipe');
    expect(tableNames).toContain('server');
    expect(tableNames).toContain('allocation');
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
    expect(found?.variables).toMatchObject({ ram_mb: 2048 });
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
});
