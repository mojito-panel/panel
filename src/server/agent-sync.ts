import '@tanstack/react-start/server-only';
import { Server } from '~/db/entities';
import { agentStatusReportSchema } from '~/contract';
import { orm, runWithOrmContext } from './orm';
import { findNodeByToken } from './node-token';
import { logActivity } from './activity';

/**
 * Agent → panel callbacks beyond SFTP (see PANEL_ROUTES in the contract):
 * the shard daemon calls these authenticated with the SAME shared per-node
 * token the panel uses to call the agent.
 */

/** Uniform refusal — no information about which check failed. */
function refuse(): Response {
  return Response.json({ error: 'Token agent invalide' }, { status: 401 });
}

/** Parses the Bearer credential of an agent call — '' when absent. */
function bearerOf(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return '';
  }
  return authorization.slice('Bearer '.length).trim();
}

/** Guards the status report read — a report is a few hundred tiny entries. */
const STATUS_REPORT_MAX_BYTES = 256 * 1024;

/**
 * Handles POST /api/agent/status — the agent reports the servers whose
 * status changed on the calling node. The DB is the single UI read path;
 * this push keeps it fresh WITHOUT a browser open (the 5 s polls only sync
 * what somebody is looking at) and writes the `server:crash` activity row
 * that future crash notifications will hook into.
 *
 * Scoped by the Bearer node token: a server id that is not one of the
 * calling node's is ignored. Rows still `installing` are skipped — that
 * lifecycle belongs to the install-status poll (`getInstallStatusFn`),
 * and the agent's "stopped" during an install must not clobber it.
 */
export async function updateStatusesForAgent(request: Request): Promise<Response> {
  return runWithOrmContext(async () => {
    const bearer = bearerOf(request);
    if (bearer.length === 0) {
      return refuse();
    }
    const node = await findNodeByToken(bearer);
    if (!node) {
      return refuse();
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > STATUS_REPORT_MAX_BYTES) {
      return Response.json({ error: 'Requête invalide' }, { status: 400 });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: 'Requête invalide' }, { status: 400 });
    }
    const report = agentStatusReportSchema.safeParse(payload);
    if (!report.success) {
      return Response.json({ error: 'Requête invalide' }, { status: 400 });
    }

    // The calling node's rows only — the report is untrusted input scoped
    // by the token, never a free-form "update any server" channel.
    const servers = await orm.em.find(Server, { nodeId: node.id });
    const byId = new Map(servers.map((server) => [server.id, server]));

    let updated = 0;
    for (const entry of report.data.statuses) {
      const server = byId.get(entry.serverId);
      if (!server || server.status === entry.status || server.status === 'installing') {
        continue;
      }
      const previous = server.status;
      server.status = entry.status;
      updated++;
      // The notification-worthy transition: the agent detected an
      // unclean exit. Everything else is routine (start/stop requested
      // through the panel anyway) and stays out of the audit trail.
      if (entry.status === 'crashed') {
        await logActivity({
          event: 'server:crash',
          description: `« ${server.name} » a planté (détection de l’agent)`,
          actor: null,
          server: { id: server.id, name: server.name },
          properties: { nodeId: node.id, from: previous, to: entry.status },
        });
      }
    }
    if (updated > 0) {
      await orm.em.flush();
    }
    return Response.json({ updated });
  });
}

/**
 * Handles GET /api/agent/servers — the agent's boot GC asks the panel
 * which servers still exist on the calling node: the panel DB is the
 * source of truth, an installed server it no longer knows (force-deleted
 * while the node was down, restored panel DB, …) is an orphan the agent
 * kills and wipes. 401 on a missing/unknown node token, 200 with the
 * node's server ids otherwise.
 */
export async function listServersForAgent(request: Request): Promise<Response> {
  return runWithOrmContext(async () => {
    const bearer = bearerOf(request);
    if (bearer.length === 0) {
      return refuse();
    }

    const node = await findNodeByToken(bearer);
    if (!node) {
      return refuse();
    }

    const servers = await orm.em.find(Server, { nodeId: node.id });
    return Response.json({ servers: servers.map((server) => server.id) });
  });
}
