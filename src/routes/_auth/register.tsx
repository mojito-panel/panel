import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { signUp } from '~/lib/auth-client';
import { registerSchema, type RegisterDto } from '~/validators/auth';

export const Route = createFileRoute('/_auth/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const form = useForm({
    validators: { onChange: registerSchema },
    defaultValues: { name: '', username: '', email: '', password: '' },
    onSubmit: ({ value }) => mutation.mutate(value),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Inscription</CardTitle>
          <CardDescription>Crée ton compte sur le panel Mojito</CardDescription>
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
                    placeholder="ton-pseudo"
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
              {mutation.isPending ? 'Inscription...' : "S'inscrire"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
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
