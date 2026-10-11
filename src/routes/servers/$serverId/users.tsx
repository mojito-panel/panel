import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Save, Trash2, UserPlus } from 'lucide-react';
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
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Checkbox } from '~/components/ui/checkbox';
import { Label } from '~/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

/** /servers/$serverId/users — sous-utilisateurs (accès partagé au serveur). */
export const Route = createFileRoute('/servers/$serverId/users')({
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
  const queryClient = useQueryClient();

  const getServer = useServerFn(getServerFn);
  const listUsers = useServerFn(listServerUsersFn);
  const addUser = useServerFn(addServerUserFn);
  const updateUser = useServerFn(updateServerUserFn);
  const removeUser = useServerFn(removeServerUserFn);

  // Shared server query (cached) — viewer grants gate the page controls
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];

  const canCreate = serverCan(permissions, { 'server.users': ['create'] });
  const canUpdate = serverCan(permissions, { 'server.users': ['update'] });
  const canRemove = serverCan(permissions, { 'server.users': ['delete'] });

  const query = useQuery({
    queryKey: ['server-users', serverId],
    queryFn: () => listUsers({ data: { serverId } }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-users', serverId] });
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

  if (!serverCan(permissions, { 'server.users': ['read'] })) {
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
      <div className="space-y-4">
        {query.isPending && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        )}
        {query.data?.map((subuser) => (
          <SubuserCard
            key={subuser.id}
            subuser={subuser}
            canUpdate={canUpdate}
            canRemove={canRemove}
            onSave={(statements) =>
              update.mutate({ userId: subuser.userId, permissions: statements })
            }
            onRemove={() => {
              if (confirm(`Retirer l’accès de « ${subuser.email} » à ce serveur ?`)) {
                remove.mutate({ userId: subuser.userId });
              }
            }}
            pending={update.isPending || remove.isPending}
          />
        ))}
        {!query.isPending && (query.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucun sous-utilisateur pour l’instant.
          </p>
        )}
      </div>
    </div>
  );
}

interface SubuserDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  permissions: string[];
  createdAt: string | null;
}

/** One sub-user: identity + inline permission editor + remove. */
function SubuserCard({
  subuser,
  canUpdate,
  canRemove,
  onSave,
  onRemove,
  pending,
}: {
  subuser: SubuserDto;
  canUpdate: boolean;
  canRemove: boolean;
  onSave: (permissions: PermissionStatements) => void;
  onRemove: () => void;
  pending: boolean;
}) {
  // Edit form — initialized from the current grant, same checkbox grid
  const form = useForm({
    defaultValues: {
      permissions: Object.fromEntries(
        subuser.permissions.map((permission) => [permission, true]),
      ) as Record<string, boolean>,
    },
    onSubmit: ({ value }) => {
      onSave(checkedToStatements(value.permissions));
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{subuser.name}</CardTitle>
            <CardDescription>{subuser.email}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {canUpdate && (
              <form.Subscribe selector={(s) => s.isSubmitting}>
                {(isSubmitting) => (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSubmitting || pending}
                    onClick={() => form.handleSubmit()}
                  >
                    <Save />
                    Enregistrer
                  </Button>
                )}
              </form.Subscribe>
            )}
            {canRemove && (
              <Button size="sm" variant="destructive" disabled={pending} onClick={onRemove}>
                <Trash2 />
                Retirer l’accès
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {SERVER_PERMISSION_GROUPS.map((group) => (
            <div key={group.resource} className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{group.label}</p>
              {group.actions.map((entry) => (
                <form.Field key={entry.permission} name={`permissions.${entry.permission}`}>
                  {(field) => (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`${subuser.id}-${entry.permission}`}
                        checked={Boolean(field.state.value)}
                        disabled={!canUpdate}
                        onCheckedChange={(checked) => field.handleChange(checked === true)}
                      />
                      <Label
                        htmlFor={`${subuser.id}-${entry.permission}`}
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
      </CardContent>
    </Card>
  );
}
