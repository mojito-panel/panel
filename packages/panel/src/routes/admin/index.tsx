import { createFileRoute, redirect } from '@tanstack/react-router';

/** /admin → /admin/nodes. */
export const Route = createFileRoute('/admin/')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/nodes' });
  },
});
