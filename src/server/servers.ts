import '@tanstack/react-start/server-only';
import { nanoid } from '~/lib/nanoid';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';
import { resolveRuntimeRecipes } from './functions/runtimes';
import type { Recipe as RecipeContract, ServerStatus } from '~/contract';
import { Node, Recipe, Server, Allocation, ServerUser, Backup } from '~/db/entities';
import type { IBackup, INode, IServer, IUser } from '~/db/types';
import { orm } from './orm';
import { HttpError } from './session';
import {
  agentInstallServer,
  agentDeleteServer,
  agentGetServer,
  agentUpdateResources,
  AgentError,
} from './agent/client';

/**
 * Server business service (server-only, like session.ts / settings.ts):
 * plain functions doing all the DB + agent work of the Servers pages,
 * running inside the caller's MikroORM request context (the
 * `withOrmContext` middleware) — they use the request-scoped EM via
 * `orm.em`, NEVER a manual `fork()`.
 */

/** Loads the node hosting a server (500 when its row is gone). */
export async function requireNodeOf(server: { nodeId: string }): Promise<INode> {
  const em = orm.em;
  return em.findOne(Node, { id: server.nodeId }).then((node) => {
    if (!node) throw new HttpError(500, 'Node introuvable');
    return node;
  });
}

/** Loads a server's recipe row (500 when its row is gone). */
export async function requireRecipeOf(server: IServer) {
  const em = orm.em;
  const recipe = await em.findOne(Recipe, { id: server.recipeId });
  if (!recipe) throw new HttpError(500, 'Recette introuvable');
  return recipe;
}

/** Loads the server's primary allocation (null when none is assigned). */
export async function findPrimaryAllocation(serverId: string) {
  const em = orm.em;
  const assigned = await em.find(Allocation, { serverId });
  return assigned.find((a) => a.primary) ?? null;
}

/**
 * Secondary ports of a server — its non-primary allocations. Pushed with
 * the resources record so the agent knows the FULL allowed port set
 * (its watchdog attributes listening sockets against it).
 */
export function secondaryPorts(allocations: { primary?: boolean | null; port: number }[]): number[] {
  return allocations
    .filter((a) => !a.primary)
    .map((a) => Number(a.port))
    .sort((a, b) => a - b);
}

/**
 * Pushes the server's full resources to the agent's cache — primary
 * port/ip plus the current memory/cpu limits, one complete record (the
 * power start/restart flow uses it as the limits sync). The new values
 * apply at the NEXT start. A 404 (agent out of sync) is ignored,
 * the DB stays the source of truth.
 */
export async function pushServerResources(server: {
  id: string;
  nodeId: string;
  // MikroORM Opt column type — Number() at the push, like every
  // other read of these fields.
  memoryMb: number | string;
  cpuCores: number | string;
}): Promise<void> {
  const em = orm.em;
  const node = await em.findOne(Node, { id: server.nodeId });
  if (!node) return;
  const assigned = await em.find(Allocation, { serverId: server.id });
  const primary = assigned.find((a) => a.primary);
  if (!primary) return;
  try {
    await agentUpdateResources(node, server.id, {
      port: primary.port,
      ip: primary.ip,
      memoryMb: Number(server.memoryMb),
      cpuCores: Number(server.cpuCores),
      ports: secondaryPorts(assigned),
    });
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
 * Creates the server row with status 'installing' and starts the agent
 * install. Pelican semantics: the chosen allocation must be free and
 * belong to the selected node; it becomes the server's primary.
 *
 * On agent refusal the row is removed and the allocation freed — the
 * whole function is one request context, so the rollback sees the SAME
 * identity map (no second fork needed).
 */
export async function installServer(
  input: {
    name: string;
    nodeId: string;
    recipeId: string;
    allocationId: string;
    memoryMb: number;
    cpuCores: number;
    variables: Record<string, string | number | boolean>;
  },
  owner: IUser,
): Promise<{ id: string; name: string }> {
  const em = orm.em;
  const node = await em.findOne(Node, { id: input.nodeId });
  if (!node) throw new HttpError(404, 'Node introuvable');

  const recipe = await em.findOne(Recipe, { id: input.recipeId });
  if (!recipe) throw new HttpError(404, 'Recette introuvable');

  const allocation = await em.findOne(Allocation, { id: input.allocationId });
  if (!allocation) throw new HttpError(404, 'Allocation introuvable');
  if (allocation.serverId !== null) {
    throw new HttpError(409, 'Cette allocation est déjà utilisée par un autre serveur');
  }
  if (allocation.nodeId !== input.nodeId) {
    throw new HttpError(422, 'Cette allocation n’appartient pas au node sélectionné');
  }

  const serverId = nanoid();
  const now = new Date();

  // 1. Persist FIRST with status 'installing' — the user is redirected to
  //    the server console right away and follows the install live.
  const server = em.create(Server, {
    id: serverId,
    name: input.name,
    nodeId: input.nodeId,
    recipeId: input.recipeId,
    ownerId: owner.id,
    status: 'installing',
    memoryMb: input.memoryMb,
    cpuCores: input.cpuCores,
    variables: input.variables,
    createdAt: now,
    updatedAt: now,
  });
  em.persist(server);

  // The claimed allocation becomes the server's primary (port + ip)
  allocation.serverId = serverId;
  allocation.primary = true;
  await em.flush();

  // 2. Start the background install on the agent (fast — the agent only
  //    validates, then runs the runner async and records every step).
  // installDir relative to the agent's dataDir.
  try {
    await agentInstallServer(node, {
      serverId,
      name: input.name,
      recipe: normalizeStoredRecipe(recipe.json),
      runtimes: await resolveRuntimeRecipes(orm.em, recipe.json),
      variables: input.variables,
      installDir: `servers/${serverId}`,
      resources: {
        port: allocation.port,
        memoryMb: input.memoryMb,
        cpuCores: input.cpuCores,
        ip: allocation.ip,
      },
    });
  } catch (err) {
    // The install could not even start → remove the server row, free the
    // allocation and report. Same request context / identity map: the
    // managed entities are already in the unit of work, no re-load needed.
    em.remove(server);
    allocation.serverId = null;
    allocation.primary = false;
    await em.flush();

    if (err instanceof AgentError) {
      throw new HttpError(502, `Installation refusée par l'agent : ${err.message}`);
    }
    throw err;
  }

  return { id: serverId, name: server.name };
}

/**
 * Deletes a server: agent cleanup first (tolerant on 404), then DB —
 * allocations return to the node's free pool, sub-user grants and backup
 * rows die with the server. Same identity map all along.
 *
 * `force` (the "node is dead" escape hatch): when the agent is UNREACHABLE
 * (or answers with any non-404 error) the deletion proceeds anyway — the
 * panel DB is the source of truth, and the leftover agent-side install is
 * cleaned up by `reconcileNodeServers` once the node answers again.
 */
export async function deleteServer(
  server: IServer,
  options: { force?: boolean } = {},
): Promise<void> {
  const em = orm.em;
  const node = await em.findOne(Node, { id: server.nodeId });

  if (node) {
    try {
      await agentDeleteServer(node, server.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof AgentError) || err.statusCode !== 404) {
        if (!options.force) {
          throw new HttpError(502, `Suppression échouée côté agent : ${message}`);
        }
      }
    }
  }

  const allocations = await em.find(Allocation, { serverId: server.id });
  for (const allocation of allocations) {
    allocation.serverId = null;
    allocation.primary = false;
  }
  const grants = await em.find(ServerUser, { serverId: server.id });
  em.remove(grants);
  const backups = await em.find(Backup, { serverId: server.id });
  em.remove(backups);
  em.remove(server);
  await em.flush();
}

/**
 * Live status reported by the agent, synced into the DB row. Returns null
 * when the agent is unreachable (NOT an error — the UI shows "Inconnu").
 */
export async function syncRuntimeStatus(
  server: IServer,
): Promise<{ status: ServerStatus; runtimeState: string | null } | null> {
  const node = await requireNodeOf(server);
  try {
    const info = await agentGetServer(node, server.id);
    if (info.status !== server.status) {
      server.status = info.status;
      await orm.em.flush();
    }
    return { status: info.status, runtimeState: info.runtimeState ?? null };
  } catch {
    return null;
  }
}

/**
 * Composition of the Server detail payload's DB half: node + recipe +
 * primary allocation of a server (all rows the page needs, one context).
 */
export async function loadServerContext(server: IServer) {
  const em = orm.em;
  const node = await em.findOne(Node, { id: server.nodeId });
  const recipe = await em.findOne(Recipe, { id: server.recipeId });
  const primaryAllocation = await findPrimaryAllocation(server.id);
  return { node, recipe, primaryAllocation };
}

/** Recipe contract payload of a stored recipe row (normalized for the agent). */
export function recipeContractOf(recipe: { json: unknown }): RecipeContract {
  return normalizeStoredRecipe(recipe.json as Record<string, unknown>) as RecipeContract;
}


/** Counts the backups of a server (admin detail page). */
export async function countServerBackups(serverId: string): Promise<number> {
  return orm.em.count(Backup, { serverId });
}

/** Counts the sub-user grants of a server (admin detail page). */
export async function countServerSubusers(serverId: string): Promise<number> {
  return orm.em.count(ServerUser, { serverId });
}

/** All backups of a server (backups list sync + limit checks). */
export async function findServerBackups(serverId: string): Promise<IBackup[]> {
  return orm.em.find(Backup, { serverId });
}
