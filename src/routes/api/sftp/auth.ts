import { createFileRoute } from '@tanstack/react-router';
import { authenticateSftp } from '~/server/sftp';

/**
 * POST /api/sftp/auth — SFTP credential validation for the agent (shard).
 * One of the agent → panel routes (wings model, see PANEL_ROUTES
 * @mojito/contract): shard's SFTP password callback calls it with the
 * node's Bearer token and the user's `{username}.{serverId}` username +
 * panel password. See `~/server/sftp`.
 */
export const Route = createFileRoute('/api/sftp/auth')({
  server: {
    handlers: {
      POST: ({ request }) => authenticateSftp(request),
    },
  },
});
