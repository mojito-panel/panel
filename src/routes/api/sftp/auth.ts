import { createFileRoute } from '@tanstack/react-router';
import { authenticateSftp } from '~/server/sftp';

/**
 * POST /api/sftp/auth — SFTP credential validation for the agent (shard).
 * The ONLY agent → panel route (wings model): shard's SFTP password callback
 * calls it with the node's Bearer token and the user's `{email}.{serverId}`
 * username + panel password. See `~/server/sftp` and `PANEL_ROUTES`
 * (@mojito/contract).
 */
export const Route = createFileRoute('/api/sftp/auth')({
  server: {
    handlers: {
      POST: ({ request }) => authenticateSftp(request),
    },
  },
});
