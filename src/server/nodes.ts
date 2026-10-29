import '@tanstack/react-start/server-only';
import { randomBytes } from 'node:crypto';
import { nanoid } from '~/lib/nanoid';
import { Node, Server, Allocation } from '~/db/entities';
import type { INode, IServer, IAllocation } from '~/db/types';
import { orm } from './orm';
import { HttpError } from './session';
import { encryptSecret } from './crypto';
import { agentHealth } from './agent/client';
import { pushServerResources } from './servers';
import { DEFAULT_SFTP_PORT } from '~/contract';

/**
 * Node + allocation-pool business service (server-only): plain functions
 * doing all the DB + agent work of the admin Nodes pages and the per-server
 * Network pages, running inside the caller's MikroORM request context (the
 * `withOrmContext` middleware).
 */

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

/** Timeout of one agent healthcheck — a detail page must stay snappy. */
const AGENT_PING_TIMEOUT_MS = 2500;

/** Best-effort live agent version (null when the agent is unreachable). */
export async function agentVersionOf(node: INode): Promise<string | null> {
  try {
    const health = await agentHealth(node, {
      signal: AbortSignal.timeout(AGENT_PING_TIMEOUT_MS),
    });
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
  // Existence check — 404 when the node is unknown.
  await requireNode(nodeId);

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
 * Deletes FREE allocations in bulk — assigned ones are skipped and reported
 * (they must be revoked first; a bulk delete never mixes the two actions).
 */
export async function deleteAllocations(
  allocations: IAllocation[],
): Promise<{ deleted: number; skipped: number }> {
  const em = orm.em;
  const free = allocations.filter((allocation) => allocation.serverId === null);
  for (const allocation of free) {
    em.remove(allocation);
  }
  await em.flush();
  return { deleted: free.length, skipped: allocations.length - free.length };
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

  // Tolerant push of the FULL record (primary port/ip + limits) — shared
  // with every other resources sync of the panel.
  if (!hadPrimary) await pushServerResources(server);
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
  if (wasPrimary && others.length > 0) {
    others[0].primary = true;
  }
  await em.flush();

  // The primary moved — push the new record (tolerant, shared helper).
  if (wasPrimary && others.length > 0 && server) await pushServerResources(server);
}

// ─── Per-server allocation actions (the Network page — shared by the
// per-server and the admin server functions) ────────────────────────────────

/**
 * Claims a FREE allocation of the server's node and assigns it to the
 * server (Pelican "add allocation"). A server without any primary promotes
 * the newcomer and syncs the agent — otherwise the primary is left alone.
 */
export async function claimServerAllocation(
  server: IServer,
  allocationId: string,
): Promise<IAllocation> {
  const em = orm.em;
  const allocation = await em.findOne(Allocation, { id: allocationId });
  if (!allocation) throw new HttpError(404, 'Allocation introuvable');
  if (allocation.serverId !== null) {
    throw new HttpError(409, 'Cette allocation est déjà utilisée par un autre serveur');
  }
  if (allocation.nodeId !== server.nodeId) {
    throw new HttpError(422, 'Cette allocation n’appartient pas au node du serveur');
  }

  const hadPrimary = (await em.find(Allocation, { serverId: server.id })).some(
    (a) => a.primary,
  );
  allocation.serverId = server.id;
  allocation.primary = !hadPrimary;
  await em.flush();

  if (!hadPrimary) await pushServerResources(server);
  return allocation;
}

/**
 * Releases a non-primary allocation — it returns to the node's free pool.
 * The primary must be moved first (refuse otherwise, like Pelican).
 */
export async function releaseServerAllocation(
  server: IServer,
  allocationId: string,
): Promise<IAllocation> {
  const em = orm.em;
  const allocation = await em.findOne(Allocation, { id: allocationId });
  if (!allocation || allocation.serverId !== server.id) {
    throw new HttpError(404, 'Allocation introuvable pour ce serveur');
  }
  if (allocation.primary) {
    throw new HttpError(409, 'Définis une autre allocation principale avant de retirer celle-ci');
  }

  allocation.serverId = null;
  allocation.primary = false;
  await em.flush();
  return allocation;
}

/**
 * Sets the primary allocation (source of SERVER_PORT / SERVER_IP) and
 * pushes the full record to the agent — the change applies at the next
 * start.
 */
export async function promoteServerAllocation(
  server: IServer,
  allocationId: string,
): Promise<IAllocation> {
  const em = orm.em;
  const allocation = await em.findOne(Allocation, { id: allocationId });
  if (!allocation || allocation.serverId !== server.id) {
    throw new HttpError(404, 'Allocation introuvable pour ce serveur');
  }

  const assigned = await em.find(Allocation, { serverId: server.id });
  for (const entry of assigned) {
    entry.primary = entry.id === allocation.id;
  }
  await em.flush();

  await pushServerResources(server);
  return allocation;
}
