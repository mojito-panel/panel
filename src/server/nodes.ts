import '@tanstack/react-start/server-only';
import { randomBytes } from 'node:crypto';
import { nanoid } from '~/lib/nanoid';
import { Node, Server, Allocation } from '~/db/entities';
import type { INode, IServer, IAllocation } from '~/db/types';
import { orm } from './orm';
import { HttpError } from './session';
import { encryptSecret } from './crypto';
import { agentHealth, agentUpdateAllocation, AgentError } from './agent/client';
import { DEFAULT_SFTP_PORT } from '~/contract';

/**
 * Node + allocation-pool business service (server-only): plain functions
 * doing all the DB + agent work of the admin Nodes pages, running inside
 * the caller's MikroORM request context (the `withOrmContext` middleware).
 */

/**
 * Tolerant push of an allocation change to the agent's cache — a 404
 * (agent out of sync) is ignored, the DB stays the source of truth.
 * Anything else surfaces as a 502.
 */
export async function pushAllocation(
  node: INode,
  serverId: string,
  allocation: { port: number; ip: string },
): Promise<void> {
  try {
    await agentUpdateAllocation(node, serverId, allocation);
  } catch (err) {
    if (err instanceof AgentError && err.statusCode === 404) {
      // tolerated — agent out of sync, DB remains the source of truth
    } else if (err instanceof AgentError) {
      throw new HttpError(502, `Synchronisation du node échouée : ${err.message}`);
    } else {
      throw err;
    }
  }
}

/**
 * Creates a node with a freshly generated agent token (encrypted at rest).
 * Returns the CLEAR token — it is shown once and never replayable again.
 */
export async function createNode(input: {
  name: string;
  fqdn: string;
  scheme: string;
  agentPort: number;
  publicPort: number;
  sftpPort?: number | null;
}): Promise<{ id: string; agentToken: string }> {
  const em = orm.em;
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const node = em.create(Node, {
    id: nanoid(),
    name: input.name,
    fqdn: input.fqdn,
    scheme: input.scheme,
    agentPort: input.agentPort,
    publicPort: input.publicPort,
    sftpPort: input.sftpPort ?? DEFAULT_SFTP_PORT,
    // Encrypted at rest — the token doubles as the console-JWT signing key
    agentToken: encryptSecret(token),
    lastSeenAt: null,
    status: 'unknown',
    createdAt: now,
    updatedAt: now,
  });
  em.persist(node);
  await em.flush();
  return { id: node.id, agentToken: token };
}

/** Loads a node (404 when unknown). */
export async function requireNode(nodeId: string): Promise<INode> {
  const node = await orm.em.findOne(Node, { id: nodeId });
  if (!node) throw new HttpError(404, 'Node introuvable');
  return node;
}

/** Deletes a node — refused while servers are still installed on it. */
export async function deleteNode(node: INode): Promise<void> {
  const em = orm.em;
  const servers = await em.find(Server, { nodeId: node.id });
  if (servers.length > 0) {
    throw new HttpError(409, `${servers.length} serveur(s) encore installé(s) sur ce node`);
  }
  em.remove(node);
  await em.flush();
}

/** Best-effort live agent version (null when the agent is unreachable). */
export async function agentVersionOf(node: INode): Promise<string | null> {
  try {
    const health = await agentHealth(node);
    return health.version;
  } catch {
    return null;
  }
}

/** Regenerates the node's agent token — the clear value is shown ONCE. */
export async function resetNodeToken(node: INode): Promise<string> {
  const token = randomBytes(32).toString('hex');
  node.agentToken = encryptSecret(token);
  await orm.em.flush();
  return token;
}

/** Free (unassigned) allocations of a node, port-sorted. */
export async function findFreeAllocations(nodeId: string): Promise<IAllocation[]> {
  const free = await orm.em.find(Allocation, { nodeId: nodeId, serverId: null });
  return free.sort((a, b) => a.port - b.port);
}

/**
 * Creates allocations on a node from an IP + ports spec. Ports already
 * allocated on that IP are skipped — the report tells the caller what was
 * created and what was left alone.
 */
export async function createAllocations(
  nodeId: string,
  ip: string,
  ports: number[],
  alias: string | null,
): Promise<{ created: number; skipped: number }> {
  const em = orm.em;
  const node = await requireNode(nodeId);
  void node;

  const existing = await em.find(Allocation, { nodeId, ip });
  const takenPorts = new Set(existing.map((a) => a.port));

  const now = new Date();
  let created = 0;
  for (const port of ports) {
    if (takenPorts.has(port)) continue;
    em.persist(
      em.create(Allocation, {
        id: nanoid(),
        nodeId,
        serverId: null,
        ip,
        port,
        alias,
        primary: false,
        createdAt: now,
      }),
    );
    created++;
  }
  await em.flush();

  return { created, skipped: ports.length - created };
}

/** Deletes a FREE allocation — an assigned one must be revoked first. */
export async function deleteAllocation(allocation: IAllocation): Promise<void> {
  const em = orm.em;
  if (allocation.serverId !== null) {
    throw new HttpError(409, 'Cette allocation est affectée à un serveur — révoque-la d’abord');
  }
  em.remove(allocation);
  await em.flush();
}

/**
 * Assigns a free allocation to a server of the same node (Pelican "assign"
 * action). A server without any primary promotes the newcomer and syncs the
 * agent cache — otherwise the primary is left untouched.
 */
export async function assignAllocation(
  allocation: IAllocation,
  server: IServer,
): Promise<void> {
  const em = orm.em;
  if (allocation.serverId !== null) {
    throw new HttpError(409, 'Cette allocation est déjà affectée à un serveur');
  }
  if (server.nodeId !== allocation.nodeId) {
    throw new HttpError(422, 'Ce serveur n’est pas installé sur le node de l’allocation');
  }

  const hadPrimary = (await em.find(Allocation, { serverId: server.id })).some(
    (a) => a.primary,
  );
  allocation.serverId = server.id;
  allocation.primary = !hadPrimary;
  await em.flush();

  if (!hadPrimary) {
    const node = await em.findOne(Node, { id: server.nodeId });
    if (node) {
      await pushAllocation(node, server.id, { port: allocation.port, ip: allocation.ip });
    }
  }
}

/**
 * Revokes an assigned allocation — it returns to the node's free pool
 * (Pelican "revoke" action). Revoking the primary promotes the first other
 * allocation of the server and syncs the agent; refusing when it is the
 * last one keeps every server reachable through a primary allocation.
 */
export async function revokeAllocation(allocation: IAllocation): Promise<void> {
  const em = orm.em;
  const assigned = await em.find(Allocation, { serverId: allocation.serverId });
  const others = assigned
    .filter((a) => a.id !== allocation.id)
    .sort((a, b) => a.port - b.port);

  if (allocation.primary && others.length === 0) {
    throw new HttpError(409, 'Un serveur doit conserver au moins une allocation principale');
  }

  const wasPrimary = allocation.primary;
  const server = await em.findOne(Server, { id: allocation.serverId });
  allocation.serverId = null;
  allocation.primary = false;
  let promoted: { port: number; ip: string } | null = null;
  if (wasPrimary && others.length > 0) {
    others[0].primary = true;
    promoted = { port: others[0].port, ip: others[0].ip };
  }
  await em.flush();

  if (wasPrimary && promoted && server) {
    const node = await em.findOne(Node, { id: server.nodeId });
    if (node) {
      await pushAllocation(node, server.id, promoted);
    }
  }
}
