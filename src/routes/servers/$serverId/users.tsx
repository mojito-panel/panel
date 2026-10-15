import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { Save, UserPlus } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
import { getServerFn } from '~/server/functions/servers';
import {
  listServerUsersFn,
  addServerUserFn,
  updateServerUserFn,
  removeServerUserFn,
} from '~/server/functions/subusers';
import {
  serverCan,
  SERVER_PERMISSION_GROUPS,
  type PermissionStatements,
} from '~/lib/permissions';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { serverSubusersList, type ServerSubuserRow } from '~/lists/subusers';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Checkbox } from '~/components/ui/checkbox';
import { Label } from '~/components/ui/label';
import { ConfirmDialog } from '~/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

/**
 * /servers/$serverId/users — sous-utilisateurs (accès partagé au serveur).
 *
 * The list definition (`~/lists/subusers`) holds the columns AND the query it
 * accepts (identity joined from `user`, so search/sort by e-mail run in SQL);
 * pagination/state live in the URL search params. The permission grid moved
 * into a dialog opened from the row action, keeping the listing a plain list.
 */
export const Route = createFileRoute('/servers/$serverId/users')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    serverSubusersList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(serverSubusersList.defaultSearch)] },
  component: ServerUsersPage,
});

/** Converts flat checked permissions into the statements wire format. */
function checkedToStatements(checked: Record<string, boolean>): PermissionStatements {
  const statements: PermissionStatements = {};
  for (const [permission, on] of Object.entries(checked)) {
    if (!on) continue;
    const index = permission.lastIndexOf('.');
    if (index <= 0) continue;
    const resource = permission.slice(0, index);
    const action = permission.slice(index + 1);
    (statements[resource] ??= []).push(action);
  }
  return statements;
}

function ServerUsersPage() {
  const { serverId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  const getServer = useServerFn(getServerFn);
  const listUsers = useServerFn(listServerUsersFn);
  const addUser = useServerFn(addServerUserFn);
  const updateUser = useServerFn(updateServerUserFn);
  const removeUser = useServerFn(removeServerUserFn);

  // Sub-user whose permissions are being edited (null = dialog closed).
  const [editing, setEditing] = useState<ServerSubuserRow | null>(null);
  // Sub-user whose removal is pending confirmation (null = dialog closed).
  const [toRemove, setToRemove] = useState<ServerSubuserRow | null>(null);

  // Shared server query (cached) — viewer grants gate the page controls
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];

  const canCreate = serverCan(permissions, { 'server.users': ['create'] });
  const canUpdate = serverCan(permissions, { 'server.users': ['update'] });
  const canRemove = serverCan(permissions, { 'server.users': ['delete'] });

  const query = useQuery({
    queryKey: ['server-subusers', serverId, search],
    queryFn: () => listUsers({ data: { ...search, serverId } }),
    placeholderData: keepPreviousData,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-subusers', serverId] });
  };

  const add = useMutation({
    mutationFn: (input: { email: string; permissions: PermissionStatements }) =>
      addUser({ data: { serverId, email: input.email, permissions: input.permissions } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Accès ajouté');
    },
    onError: (error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: (input: { userId: string; permissions: PermissionStatements }) =>
      updateUser({ data: { serverId, userId: input.userId, permissions: input.permissions } }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      toast.success('Permissions mises à jour');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (input: { userId: string }) =>
      removeUser({ data: { serverId, userId: input.userId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Accès retiré');
    },
    onError: (error) => toast.error(error.message),
  });

  // "Add a user" form — email + permission checkboxes (TanStack Form)
  const addForm = useForm({
    defaultValues: {
      email: '',
      permissions: {} as Record<string, boolean>,
    },
    onSubmit: ({ value }) => {
      const statements = checkedToStatements(value.permissions);
      if (Object.keys(statements).length === 0) {
        toast.error('Sélectionne au moins une permission');
        return;
      }
      add.mutate({ email: value.email, permissions: statements });
    },
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  // Only deny once the viewer grants are known — while the server query is
  // in flight the table below renders its own skeleton
  if (serverQuery.isSuccess && !serverCan(permissions, { 'server.users': ['read'] })) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu n’as pas la permission de gérer les utilisateurs de ce serveur.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Add a sub-user ─── */}
      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Donner accès à un utilisateur</CardTitle>
            <CardDescription>
              Le compte doit déjà exister — son e-mail suffit. Les permissions
              sont granulaires (Pelican « sub-user ») : chaque case ci-dessous
              déverrouille une action précise sur CE serveur.
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addForm.handleSubmit();
            }}
          >
            <CardContent className="space-y-4">
              <addForm.Field name="email">
                {(field) => (
                  <div className="max-w-sm space-y-2">
                    <Input
                      type="email"
                      placeholder="Adresse e-mail du compte à inviter"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </div>
                )}
              </addForm.Field>

              {/* Permission checkboxes (grouped by resource) */}
              <div className="grid gap-4 sm:grid-cols-2">
                {SERVER_PERMISSION_GROUPS.map((group) => (
                  <div key={group.resource} className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">{group.label}</p>
                    {group.actions.map((entry) => (
                      <addForm.Field
                        key={entry.permission}
                        name={`permissions.${entry.permission}`}
                      >
                        {(field) => (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`add-${entry.permission}`}
                              checked={Boolean(field.state.value)}
                              onCheckedChange={(checked) =>
                                field.handleChange(checked === true)
                              }
                            />
                            <Label
                              htmlFor={`add-${entry.permission}`}
                              className="text-sm font-normal"
                            >
                              {entry.label}
                            </Label>
                          </div>
                        )}
                      </addForm.Field>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <addForm.Subscribe selector={(s) => [s.isSubmitting, add.isPending]}>
                {([isSubmitting, pending]) => (
                  <Button type="submit" disabled={isSubmitting || pending}>
                    <UserPlus />
                    {pending ? 'Ajout…' : 'Donner l’accès'}
                  </Button>
                )}
              </addForm.Subscribe>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* ─── Current sub-users ─── */}
      <DataTable
        list={serverSubusersList}
        rows={query.data?.rows ?? []}
        rowCount={query.data?.rowCount ?? 0}
        search={search}
        onSearchChange={onSearchChange}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        emptyMessage="Aucun sous-utilisateur pour l’instant."
        rowContext={{
          canManage: canUpdate || canRemove,
          removing: update.isPending || remove.isPending,
          onEdit: setEditing,
          onRemove: setToRemove,
        }}
      />

      {/* Edit a sub-user's permissions — remounts per row so the checkboxes
          reflect the grant being edited (TanStack Form + the existing
          updateServerUserFn validator). */}
      <SubuserPermissionsDialog
        key={editing?.id ?? 'closed'}
        subuser={editing}
        pending={update.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(statements) => {
          if (editing) update.mutate({ userId: editing.userId, permissions: statements });
        }}
      />
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        onConfirm={() => {
          if (toRemove) remove.mutate({ userId: toRemove.userId });
          setToRemove(null);
        }}
        title={toRemove ? `Retirer l’accès de « ${toRemove.email} » à ce serveur ?` : ''}
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

/** Permission editor of one sub-user, opened from the row action. */
function SubuserPermissionsDialog({
  subuser,
  pending,
  onClose,
  onSubmit,
}: {
  /** Sub-user being edited, or null when the dialog is closed. */
  subuser: ServerSubuserRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (permissions: PermissionStatements) => void;
}) {
  const form = useForm({
    defaultValues: {
      permissions: Object.fromEntries(
        subuser?.permissions.map((permission) => [permission, true]) ?? [],
      ) as Record<string, boolean>,
    },
    onSubmit: ({ value }) => {
      const statements = checkedToStatements(value.permissions);
      if (Object.keys(statements).length === 0) {
        toast.error('Sélectionne au moins une permission');
        return;
      }
      onSubmit(statements);
    },
  });

  return (
    <Dialog open={subuser !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permissions de l’accès</DialogTitle>
          <DialogDescription>
            {subuser ? `${subuser.name} — ${subuser.email}` : ''}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
            {SERVER_PERMISSION_GROUPS.map((group) => (
              <div key={group.resource} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{group.label}</p>
                {group.actions.map((entry) => (
                  <form.Field
                    key={entry.permission}
                    name={`permissions.${entry.permission}`}
                  >
                    {(field) => (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${subuser?.id ?? 'edit'}-${entry.permission}`}
                          checked={Boolean(field.state.value)}
                          onCheckedChange={(checked) => field.handleChange(checked === true)}
                        />
                        <Label
                          htmlFor={`${subuser?.id ?? 'edit'}-${entry.permission}`}
                          className="text-sm font-normal"
                        >
                          {entry.label}
                        </Label>
                      </div>
                    )}
                  </form.Field>
                ))}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <form.Subscribe selector={(s) => [s.isSubmitting, pending]}>
              {([isSubmitting, isPending]) => (
                <Button type="submit" disabled={isSubmitting || isPending}>
                  <Save />
                  {isPending ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
