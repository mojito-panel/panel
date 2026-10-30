import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { RegisterForm } from '~/components/auth/register-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { signIn } from '~/lib/auth-client';
import { createFirstAdminFn } from '~/server/functions/setup';

/**
 * First-run setup (/setup) — only reachable while no account exists:
 * __root.tsx redirects every page here, and back to / once an account
 * does. Creates the first account with the built-in `admin` role, then
 * signs in.
 */
export const Route = createFileRoute('/_auth/setup')({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: {
      name: string;
      username: string;
      email: string;
      password: string;
    }) => {
      await createFirstAdminFn({ data });
      // Establish the session (better-auth cookie) right away
      const { error } = await signIn.email({
        email: data.email,
        password: data.password,
      });
      if (error) throw new Error(error.message ?? 'Erreur lors de la connexion');
    },
    onSuccess: async () => {
      // Invalidate the auth + setup caches to refetch server-side
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await queryClient.invalidateQueries({ queryKey: ['setup'] });
      await navigate({ to: '/' });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Configuration initiale</CardTitle>
          <CardDescription>
            Aucun compte n’existe encore — crée le compte administrateur du panel
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RegisterForm
            onSubmit={(value) => mutation.mutate(value)}
            submitLabel="Créer le compte administrateur"
            pendingLabel="Création..."
            pending={mutation.isPending}
          />

          {mutation.isError && <p className="text-destructive text-sm">{mutation.error.message}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
