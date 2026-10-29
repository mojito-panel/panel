import { createFileRoute } from '@tanstack/react-router';
import { updateStatusesForAgent } from '~/server/agent-sync';

/**
 * POST /api/agent/status — the agent reports the servers whose status
 * changed on the calling node (push-on-change, node Bearer token). The
 * panel DB stays fresh without a browser open; the `server:crash`
 * activity row is the future notification hook. See `~/server/agent-sync`
 * and PANEL_ROUTES @mojito/contract.
 */
export const Route = createFileRoute('/api/agent/status')({
  server: {
    handlers: {
      POST: ({ request }) => updateStatusesForAgent(request),
    },
  },
});
