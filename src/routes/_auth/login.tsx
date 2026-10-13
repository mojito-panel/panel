import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { signIn } from '~/lib/auth-client';
import { getBrandingFn } from '~/server/functions/settings';
import { loginSchema, type LoginDto } from '~/validators/auth';

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Registration toggle (admin > Paramètres) — the sign-up link is hidden
  // while public registration is closed (prefetched SSR, no flash).
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  const mutation = useMutation({
    mutationFn: async (data: LoginDto) => {
      const { error } = await signIn.email(data);
      if (error) throw new Error(error.message ?? 'Identifiants invalides');
    },
    onSuccess: async () => {
      // Invalidate the auth cache to refetch the session server-side
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await navigate({ to: '/' });
    },
  });

  const form = useForm({
    validators: { onChange: loginSchema },
    defaultValues: { email: '', password: '' },
    onSubmit: ({ value }) => mutation.mutate(value),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connexion</CardTitle>
          <CardDescription>Connecte-toi à ton panel Mojito</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="email"
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="current-password"
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {mutation.isError && (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'Connexion...' : 'Se connecter'}
            </Button>
          </form>
          {(brandingQuery.data?.registrationEnabled ?? true) && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Pas encore de compte ?{' '}
              <Link to="/register" className="text-primary underline-offset-4 hover:underline">
                S'inscrire
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
