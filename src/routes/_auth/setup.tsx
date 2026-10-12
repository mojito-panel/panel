import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useForm } from '@tanstack/react-form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { signIn } from '~/lib/auth-client';
import { createFirstAdminFn } from '~/server/functions/setup';
import { registerSchema, type RegisterDto } from '~/validators/auth';

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
    mutationFn: async (data: RegisterDto) => {
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

  const form = useForm({
    validators: { onChange: registerSchema },
    defaultValues: { name: '', username: '', email: '', password: '' },
    onSubmit: ({ value }) => mutation.mutate(value),
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
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="name">Nom</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Ton nom"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="name"
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="username">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="username">Nom d’utilisateur</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="admin"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="username"
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

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
                    placeholder="8 caractères minimum"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="new-password"
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
              {mutation.isPending ? 'Création...' : 'Créer le compte administrateur'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
