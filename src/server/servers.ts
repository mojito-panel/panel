import '@tanstack/react-start/server-only';
import { nanoid } from '~/lib/nanoid';
import { mergeVariableValues } from '~/lib/recipe-merge';
import {
  buildRecipeSnapshot,
  serverRecipeSnapshot,
  type ServerRecipeSnapshot,
} from './recipe-snapshot';
import type { Recipe as RecipeContract, ServerStatus } from '~/contract';
import { Node, Recipe, Server, Allocation, ServerUser, Backup } from '~/db/entities';
import type { IBackup, INode, IServer, IUser } from '~/db/types';
import { orm } from './orm';
import { HttpError } from './session';
import {
  agentInstallServer,
  agentReinstallServer,
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

  // Self-contained from birth: the server stores the SNAPSHOT of its
  // recipe (app + resolved runtimes + merged variable definitions) and
  // the merged variable VALUES — submitted form values over the
  // definitions' defaults (runtime variables like JAVA_VERSION included).
  // A recipe edited later never impacts this server.
  const snapshot = await buildRecipeSnapshot(
    orm.em,
    recipe.json as Record<string, unknown>,
  );
  const variables = mergeVariableValues(
    snapshot.recipe.variables ?? [],
    input.variables,
  );

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
    variables,
    recipeSnapshot: snapshot.recipe as unknown as Record<string, unknown>,
    runtimeSnapshots: snapshot.runtimes,
    recipeSyncedAt: now,
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
      recipe: snapshot.recipe,
      runtimes: snapshot.runtimes,
      variables,
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
 * Re-snapshots a server from the CURRENT recipe row (app + resolved
 * runtimes), keeping the current variable values — defaults only fill
 * newly declared envs. Pure panel DB: no agent call, nothing installed —
 * the next reinstall applies the new snapshot.
 *
 * Persisted IMMEDIATELY (own flush): a reload survives a later agent
 * failure, so the "recipe updated since snapshot" banner clears and the
 * merged variable definitions are visible on the Variables page right
 * away.
 */
export async function refreshServerRecipeSnapshot(
  server: IServer,
  options: { recipeId?: string } = {},
): Promise<ServerRecipeSnapshot> {
  const em = orm.em;

  if (options.recipeId && options.recipeId !== server.recipeId) {
    const target = await em.findOne(Recipe, { id: options.recipeId });
    if (!target) throw new HttpError(404, 'Recette introuvable');
    server.recipeId = options.recipeId;
  }

  const recipe = await requireRecipeOf(server);
  const snapshot = await buildRecipeSnapshot(em, recipe.json as Record<string, unknown>);
  server.recipeSnapshot = snapshot.recipe as unknown as Record<string, unknown>;
  server.runtimeSnapshots = snapshot.runtimes;
  server.recipeSyncedAt = new Date();
  server.variables = mergeVariableValues(snapshot.recipe.variables ?? [], server.variables);
  await em.flush();
  return snapshot;
}

/**
 * Reinstalls a server from its SNAPSHOT — the stored recipe is the one
 * and only thing the agent ever sees. `refreshSnapshot` re-snapshots from
 * the current recipe row first (the explicit "reload recipe" propagation
 * path — current variable values win, defaults only fill newly declared
 * envs); `recipeId` points the server at another recipe before that (the
 * admin "change recipe" action). The agent reinstall re-runs the install
 * steps in place; a 404 (agent store out of sync — failed first install,
 * lost dataDir) falls back to a FULL install rebuilt from the panel DB.
 */
export async function reinstallServerFromPanel(
  server: IServer,
  options: { refreshSnapshot?: boolean; recipeId?: string } = {},
): Promise<{ message: string }> {
  const em = orm.em;
  const node = await requireNodeOf(server);

  let snapshot: ServerRecipeSnapshot;
  if (options.refreshSnapshot || options.recipeId || !server.recipeSnapshot || !server.runtimeSnapshots) {
    // Persisted BEFORE the agent call (own flush inside) — a refused
    // reinstall must not lose the reloaded snapshot nor leave the server
    // marked as outdated.
    snapshot = await refreshServerRecipeSnapshot(server, { recipeId: options.recipeId });
  } else {
    snapshot = await serverRecipeSnapshot(em, server);
  }

  const allocations = await em.find(Allocation, { serverId: server.id });
  const allocation = allocations.find((a) => a.primary);
  if (!allocation) throw new HttpError(500, 'Allocation introuvable');

  try {
    const result = await agentReinstallServer(node, server.id, {
      recipe: snapshot.recipe,
      runtimes: snapshot.runtimes,
      variables: server.variables,
    });
    server.status = 'installing';
    await em.flush();
    return { message: result.message };
  } catch (err) {
    if (!(err instanceof AgentError) || err.statusCode !== 404) {
      if (err instanceof AgentError) {
        throw new HttpError(502, `Réinstallation refusée côté agent : ${err.message}`);
      }
      throw err;
    }
    // The agent doesn't know the server: its store is only written on
    // install SUCCESS — fall back to a FULL install rebuilt from the DB.
    try {
      await agentInstallServer(node, {
        serverId: server.id,
        name: server.name,
        recipe: snapshot.recipe,
        runtimes: snapshot.runtimes,
        variables: server.variables,
        installDir: `servers/${server.id}`,
        resources: {
          port: allocation.port,
          memoryMb: server.memoryMb,
          cpuCores: Number(server.cpuCores),
          ip: allocation.ip,
          ports: secondaryPorts(allocations),
        },
      });
    } catch (fallbackErr) {
      if (fallbackErr instanceof AgentError) {
        throw new HttpError(502, `Réinstallation refusée côté agent : ${fallbackErr.message}`);
      }
      throw fallbackErr;
    }
    server.status = 'installing';
    await em.flush();
    return { message: 'Réinstallation démarrée (installation complète)' };
  }
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
