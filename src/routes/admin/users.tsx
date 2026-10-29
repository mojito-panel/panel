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
import { hasPermissions } from '~/lib/permissions';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminUsersList, type AdminUserRow, type AdminUsersContext } from '~/lists/users';
import type { RoleDto } from '~/lists/roles';
import { z } from 'zod';
import { Button } from '~/components/ui/button';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { Input } from '~/components/ui/input';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

/**
 * /admin/users — the panel accounts: roles, suspension, deletion.
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

/**
 * Ban reason of the suspend dialog — a tiny local schema: the dialog lives
 * entirely on this page and the wire only carries an optional string, so
 * a `validators/` module would be overkill.
 */
const banReasonSchema = z.object({
  banReason: z.string().trim().max(255),
});

function AdminUsersPage() {
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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
  const canCreate = hasPermissions(permissions, { user: ['create'] });
  const canSetRole = hasPermissions(permissions, { user: ['set-role'] });
  const canBan = hasPermissions(permissions, { user: ['ban'] });
  const canDelete = hasPermissions(permissions, { user: ['delete'] });

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
      setBanTarget(null);
      banForm.reset();
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

  // The ban reason is a FORM field (never useState) — a tiny TanStack Form
  // scoped to the suspend dialog; the dialog's confirm button submits it
  // (banForm.handleSubmit), and the dialog closes on the mutation's
  // success only.
  const banForm = useForm({
    validators: { onChange: banReasonSchema },
    defaultValues: { banReason: '' },
    onSubmit: ({ value }) => {
      if (!banTarget) return;
      ban.mutate({ userId: banTarget.id, banReason: value.banReason.trim() || undefined });
    },
  });

  const confirmBan = (target: AdminUserRow) => {
    setBanTarget(target);
    banForm.reset();
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
          {canCreate && (
            <CardAction>
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus />
                Créer un utilisateur
              </Button>
            </CardAction>
          )}
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

      {/* ─── Create user (dialog opened from the list card's action button) ─── */}
      {canCreate && (
        <CreateUserDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          createUser={createUser}
          onCreated={invalidate}
          roles={roles}
        />
      )}

      {/* ─── Confirm dialogs ─── */}
      <ConfirmDialog
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBanTarget(null);
        }}
        onConfirm={() => void banForm.handleSubmit()}
        title={`Suspendre « ${banTarget?.email ?? ''} » ?`}
        description="Il ne pourra plus se connecter. Ses sessions actives seront révoquées."
        confirmLabel="Suspendre"
        destructive
        pending={ban.isPending}
      >
        {/* The reason is a TanStack Form field (schema above) — never useState. */}
        <banForm.Field name="banReason">
          {(field) => (
            <div className="space-y-1">
              <Input
                placeholder="Raison de la suspension (optionnelle)"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={ban.isPending}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-destructive">
                  {field.state.meta.errors[0]?.message}
                </p>
              )}
            </div>
          )}
        </banForm.Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync({ userId: deleteTarget.id });
            setDeleteTarget(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
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

/** "Create a user" dialog, opened from the list card's action button. */
function CreateUserDialog({
  open,
  onOpenChange,
  createUser,
  onCreated,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      onOpenChange(false);
      toast.success('Compte créé');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Créer un utilisateur</DialogTitle>
          <DialogDescription>
            Le mot de passe est défini directement — l’utilisateur pourra se
            connecter immédiatement.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="sm:col-span-2">
              <form.Field name="role">
                {(field) => (
                  <div className="space-y-2">
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => v !== null && field.handleChange(v)}
                    >
                      <SelectTrigger className="w-full">
                        {/* base-ui only resolves an item's LABEL once that item is
                            mounted (i.e. after the popup opened) — a closed trigger
                            would show the raw value, so the label is resolved here. */}
                        <SelectValue placeholder="Rôle">
                          {(current: string | null) =>
                            roles.find((role) => role.id === current)?.name ?? current ?? 'Rôle'
                          }
                        </SelectValue>
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
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting || create.isPending}>
                  <UserPlus />
                  {isSubmitting || create.isPending ? 'Création…' : 'Créer le compte'}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
