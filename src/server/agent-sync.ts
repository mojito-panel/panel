import '@tanstack/react-start/server-only';
import { Server } from '~/db/entities';
import { orm, runWithOrmContext } from './orm';
import { findNodeByToken } from './node-token';

/**
 * Agent → panel callbacks beyond SFTP (see PANEL_ROUTES in the contract):
 * the shard daemon calls these at boot, authenticated with the SAME
 * shared per-node token the panel uses to call the agent.
 */

/** Uniform refusal — no information about which check failed. */
function refuse(): Response {
  return Response.json({ error: 'Token agent invalide' }, { status: 401 });
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
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return refuse();
    }
    const bearer = authorization.slice('Bearer '.length).trim();
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
