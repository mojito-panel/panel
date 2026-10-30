import { createFileRoute } from '@tanstack/react-router';

import { listServersForAgent } from '~/server/agent-sync';

/**
 * GET /api/agent/servers — the ids of the servers the panel still knows on
 * the calling node. Called by the agent (shard) at boot with the node's
 * Bearer token to garbage-collect orphaned installations: a server
 * installed on the agent but absent from this list is killed and wiped
 * (see `~/server/agent-sync` and `PANEL_ROUTES` @mojito/contract).
 */
export const Route = createFileRoute('/api/agent/servers')({
  server: {
    handlers: {
      GET: ({ request }) => listServersForAgent(request),
    },
  },
});
