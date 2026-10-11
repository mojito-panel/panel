import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm, useStore } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Ban, CircleCheck, Search, Trash2, UserPlus } from 'lucide-react';
import {
  listUsersFn,
  createUserFn,
  setUserRoleFn,
  banUserFn,
  unbanUserFn,
  deleteUserFn,
} from '~/server/functions/users';
import { listRolesFn } from '~/server/functions/roles';
import { createUserFormSchema, type CreateUserFormDto } from '~/validators/user';
import { useAuth } from '~/contexts/use-auth';
import { canFromPermissions } from '~/lib/permissions';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

/** /admin/users — comptes du panel : rôles, suspension, suppression. */
export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

/** One entry of the role picker (built-ins + custom roles from listRolesFn). */
interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
  builtIn: boolean;
}

interface AdminUserDto {
  id: string;
  name: string | null;
  email: string;
  role: string;
  roleName: string;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  createdAt: string | null;
  serverCount: number;
}

function AdminUsersPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const queryClient = useQueryClient();

  const listUsers = useServerFn(listUsersFn);
  const createUser = useServerFn(createUserFn);
  const setUserRole = useServerFn(setUserRoleFn);
  const banUser = useServerFn(banUserFn);
  const unbanUser = useServerFn(unbanUserFn);
  const deleteUser = useServerFn(deleteUserFn);

  // Panel-level grants — the server functions enforce the same ones
  // (list / create / set-role / ban / delete)
  const canCreate = canFromPermissions(permissions, { user: ['create'] });
  const canSetRole = canFromPermissions(permissions, { user: ['set-role'] });
  const canBan = canFromPermissions(permissions, { user: ['ban'] });
  const canDelete = canFromPermissions(permissions, { user: ['delete'] });

  // Roles (built-ins + custom) — feeds both role pickers
  const listRoles = useServerFn(listRolesFn);
  const rolesQuery = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => listRoles(),
  });
  const roles: RoleDto[] = rolesQuery.data ?? [];

  // Search form — the value feeds the query key reactively (no useState)
  const searchForm = useForm({
    defaultValues: { search: '' },
  });
  const search = useStore(searchForm.store, (s) => s.values.search);

  const query = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => listUsers({ data: { search: search || undefined } }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const users: AdminUserDto[] = query.data?.users ?? [];

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      setUserRole({ data: input }),
    onSuccess: async (result) => {
      await invalidate();
      const label = roles.find((r) => r.id === result.role)?.name ?? result.role;
      toast.success('Rôle mis à jour', { description: label });
    },
    onError: (error) => toast.error(error.message),
  });

  const ban = useMutation({
    mutationFn: (input: { userId: string; banReason?: string }) =>
      banUser({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Compte suspendu', {
        description: 'Ses sessions ont été révoquées.',
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const unban = useMutation({
    mutationFn: (input: { userId: string }) => unbanUser({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Compte réactivé');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (input: { userId: string }) => deleteUser({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Compte supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  const confirmBan = (target: AdminUserDto) => {
    if (!confirm(`Suspendre « ${target.email} » ? Il ne pourra plus se connecter.`)) {
      return;
    }
    const reason = prompt('Raison de la suspension (optionnelle) :');
    ban.mutate({ userId: target.id, banReason: reason ?? undefined });
  };

  const confirmDelete = (target: AdminUserDto) => {
    if (confirm(`Supprimer définitivement « ${target.email} » ?`)) {
      remove.mutate({ userId: target.id });
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── Users list ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Utilisateurs</CardTitle>
          <CardDescription>
            Comptes du panel : rôles (administrateur / modérateur /
            utilisateur), suspension et suppression. La suspension révoque
            immédiatement les sessions actives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search bar — live filtering on email */}
          <searchForm.Field name="search">
            {(field) => (
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Rechercher un e-mail…"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </searchForm.Field>

          {query.isPending && (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          )}
          {query.isError && (
            <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
          )}

          {users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Utilisateur</th>
                    <th className="py-2 pr-4 font-medium">Rôle</th>
                    <th className="py-2 pr-4 font-medium">Serveurs</th>
                    <th className="py-2 pr-4 font-medium">Statut</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((target) => {
                    const isSelf = target.id === user?.id;
                    return (
                      <tr key={target.id} className={target.banned ? 'opacity-60' : undefined}>
                        <td className="py-2 pr-4">
                          <p className="font-medium">{target.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{target.email}</p>
                        </td>
                        <td className="py-2 pr-4">
                          {canSetRole && !isSelf ? (
                            <Select
                              value={target.role}
                              onValueChange={(role) =>
                                changeRole.mutate({ userId: target.id, role })
                              }
                            >
                              <SelectTrigger className="w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {roles.map((role) => (
                                  <SelectItem key={role.id} value={role.id}>
                                    {role.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span>{target.roleName}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{target.serverCount}</td>
                        <td className="py-2 pr-4">
                          {target.banned ? (
                            <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-xs text-destructive">
                              Suspendu
                            </span>
                          ) : (
                            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                              Actif
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex justify-end gap-1">
                            {canBan && !isSelf && (
                              target.banned ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => unban.mutate({ userId: target.id })}
                                  disabled={unban.isPending}
                                >
                                  <CircleCheck />
                                  Réactiver
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => confirmBan(target)}
                                  disabled={ban.isPending}
                                >
                                  <Ban />
                                  Suspendre
                                </Button>
                              )
                            )}
                            {canDelete && !isSelf && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => confirmDelete(target)}
                                disabled={remove.isPending}
                              >
                                <Trash2 />
                                Supprimer
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !query.isPending && (
              <p className="text-sm text-muted-foreground">Aucun utilisateur.</p>
            )
          )}
        </CardContent>
      </Card>

      {/* ─── Create user ─── */}
      {canCreate && (
        <CreateUserCard createUser={createUser} onCreated={invalidate} roles={roles} />
      )}
    </div>
  );
}

/** "Create a user" card (name, email, password, role). */
function CreateUserCard({
  createUser,
  onCreated,
  roles,
}: {
  createUser: (args: { data: CreateUserFormDto }) => Promise<{ id: string; email: string; role: string }>;
  onCreated: () => Promise<void>;
  roles: RoleDto[];
}) {
  const form = useForm({
    validators: { onChange: createUserFormSchema },
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: 'user',
    },
    onSubmit: ({ value }) => create.mutate(value),
  });

  const create = useMutation({
    mutationFn: (value: CreateUserFormDto) => createUser({ data: value }),
    onSuccess: async () => {
      await onCreated();
      form.reset();
      toast.success('Compte créé');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Créer un utilisateur</CardTitle>
        <CardDescription>
          Le mot de passe est défini directement — l’utilisateur pourra se
          connecter immédiatement.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Input
                  placeholder="Nom"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
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
                <Input
                  type="email"
                  placeholder="Adresse e-mail"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
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
                <Input
                  type="password"
                  placeholder="Mot de passe (8 caractères min.)"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <div className="space-y-2">
                <Select
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Rôle" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </CardContent>
        <CardFooter>
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting || create.isPending}>
                <UserPlus />
                {isSubmitting || create.isPending ? 'Création…' : 'Créer le compte'}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
}
