import { createFileRoute } from '@tanstack/react-router';

import { auth } from '~/lib/auth';

/**
 * better-auth catch-all route — all /api/auth/* routes go through here.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
