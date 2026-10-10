import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Public root: redirects to servers if signed in, otherwise to /login.
 * All app pages live under the _app layout (sidebar).
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: unknown }).user;
    throw redirect({ to: user ? '/servers' : '/login' });
  },
});
