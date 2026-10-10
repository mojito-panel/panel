import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/lib/auth';

/**
 * Route catch-all better-auth — toutes les routes /api/auth/* passent par ici.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
