import { useState } from 'react';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
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
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminUsersList, type AdminUserRow, type AdminUsersContext } from '~/lists/users';
import { Button } from '~/components/ui/button';
import { ConfirmDialog } from '~/components/confirm-dialog';
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

/**
 * /admin/users — comptes du panel : rôles, suspension, suppression.
 * Filtering, sorting and pagination run in the database; the list definition
 * (`~/lists/users`) holds the columns AND the query it accepts, the state
 * lives in the URL search params.
 */
export const Route = createFileRoute('/admin/users')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminUsersList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminUsersList.defaultSearch)] },
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

function AdminUsersPage() {
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

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

  const query = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => listUsers({ data: search }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });

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

  const confirmBan = (target: AdminUserRow) => {
    setBanTarget(target);
    setBanReason('');
  };

  const confirmDelete = (target: AdminUserRow) => {
    setDeleteTarget(target);
  };

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const busy =
    changeRole.isPending || ban.isPending || unban.isPending || remove.isPending;

  const rowContext: AdminUsersContext = {
    canSetRole,
    canBan,
    canDelete,
    roles: roles.map((role) => ({ id: role.id, name: role.name })),
    busy,
    isSelf: (target) => target.id === user?.id,
    onRoleChange: (target, roleId) => changeRole.mutate({ userId: target.id, role: roleId }),
    onBan: confirmBan,
    onUnban: (target) => unban.mutate({ userId: target.id }),
    onDelete: confirmDelete,
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
        <CardContent>
          <DataTable
            list={adminUsersList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucun utilisateur."
            filterOptions={{
              role: roles.map((role) => ({ value: role.id, label: role.name })),
            }}
            rowContext={rowContext}
          />
        </CardContent>
      </Card>

      {/* ─── Create user ─── */}
      {canCreate && (
        <CreateUserCard createUser={createUser} onCreated={invalidate} roles={roles} />
      )}

      {/* ─── Confirm dialogs ─── */}
      <ConfirmDialog
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBanTarget(null);
        }}
        onConfirm={() => {
          if (banTarget) {
            ban.mutate({ userId: banTarget.id, banReason: banReason || undefined });
          }
          setBanTarget(null);
          setBanReason('');
        }}
        title={`Suspendre « ${banTarget?.email ?? ''} » ?`}
        description="Il ne pourra plus se connecter. Ses sessions actives seront révoquées."
        confirmLabel="Suspendre"
        destructive
        pending={ban.isPending}
      >
        <Input
          placeholder="Raison de la suspension (optionnelle)"
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) {
            remove.mutate({ userId: deleteTarget.id });
          }
          setDeleteTarget(null);
        }}
        title={`Supprimer définitivement « ${deleteTarget?.email ?? ''} » ?`}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        destructive
        pending={remove.isPending}
      />
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
      username: '',
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
          <form.Field name="username">
            {(field) => (
              <div className="space-y-2">
                <Input
                  placeholder="Nom d’utilisateur (SFTP)"
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
                  onValueChange={(v) => v !== null && field.handleChange(v)}
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
