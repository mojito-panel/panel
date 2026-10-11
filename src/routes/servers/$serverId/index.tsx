import { createFileRoute, redirect } from '@tanstack/react-router';

/** /servers/$serverId → console (Pelican: /server/{uuid} redirects to console). */
export const Route = createFileRoute('/servers/$serverId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/servers/$serverId/console', params });
  },
});
