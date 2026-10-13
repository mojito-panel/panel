import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { RegisterForm } from '~/components/auth/register-form';
import { signUp } from '~/lib/auth-client';
import { getBrandingFn } from '~/server/functions/settings';
import type { RegisterDto } from '~/validators/auth';

export const Route = createFileRoute('/_auth/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Registration toggle (admin > Paramètres) — enforced server-side by the
  // better-auth hook; prefetched SSR so there is no form flash.
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  const mutation = useMutation({
    mutationFn: async (data: RegisterDto) => {
      const { error } = await signUp.email(data);
      if (error) throw new Error(error.message ?? "Erreur lors de l'inscription");
    },
    onSuccess: async () => {
      // Invalidate the auth cache to refetch the session server-side
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await navigate({ to: '/' });
    },
  });

  if (brandingQuery.data && !brandingQuery.data.registrationEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Inscriptions désactivées</CardTitle>
            <CardDescription>
              La création de compte public est actuellement fermée par un
              administrateur du panel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Déjà un compte ?{' '}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Se connecter
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Inscription</CardTitle>
          <CardDescription>Crée ton compte sur le panel Mojito</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RegisterForm
            onSubmit={(value) => mutation.mutate(value)}
            submitLabel="S'inscrire"
            pendingLabel="Inscription..."
            pending={mutation.isPending}
          />

          {mutation.isError && (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Déjà un compte ?{' '}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
