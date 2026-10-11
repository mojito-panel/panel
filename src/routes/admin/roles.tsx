import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import {
  listRolesFn,
  createRoleFn,
  updateRoleFn,
  deleteRoleFn,
} from '~/server/functions/roles';
import { useAuth } from '~/contexts/use-auth';
import {
  canFromPermissions,
  PANEL_PERMISSION_GROUPS,
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

/** /admin/roles — rôles du panel (Pelican-style) : rôles intégrés + rôles personnalisés. */
export const Route = createFileRoute('/admin/roles')({
  component: AdminRolesPage,
});

interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
  builtIn: boolean;
}

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

function AdminRolesPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const queryClient = useQueryClient();

  const listRoles = useServerFn(listRolesFn);
  const createRole = useServerFn(createRoleFn);
  const updateRole = useServerFn(updateRoleFn);
  const deleteRole = useServerFn(deleteRoleFn);

  const canCreate = canFromPermissions(permissions, { 'panel.roles': ['create'] });
  const canUpdate = canFromPermissions(permissions, { 'panel.roles': ['update'] });
  const canDelete = canFromPermissions(permissions, { 'panel.roles': ['delete'] });

  const query = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => listRoles(),
  });

  const invalidate = async () => {
    // Role edits change what users can do — refresh the cached roles list
    // AND the session's effective permissions (SessionUser.permissions)
    await queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
    await queryClient.invalidateQueries({ queryKey: ['auth'] });
  };

  const create = useMutation({
    mutationFn: (input: { name: string; description?: string; permissions: PermissionStatements }) =>
      createRole({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Rôle créé');
    },
    onError: (error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: (input: { roleId: string; name: string; description?: string; permissions: PermissionStatements }) =>
      updateRole({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Rôle mis à jour');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (input: { roleId: string }) => deleteRole({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Rôle supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  // "Create a role" form (name, description, permission matrix)
  const createForm = useForm({
    defaultValues: {
      name: '',
      description: '',
      permissions: {} as Record<string, boolean>,
    },
    onSubmit: ({ value }) => {
      const statements = checkedToStatements(value.permissions);
      if (Object.keys(statements).length === 0) {
        toast.error('Sélectionne au moins une permission');
        return;
      }
      create.mutate({
        name: value.name,
        description: value.description || undefined,
        permissions: statements,
      });
    },
  });

  if (!canFromPermissions(permissions, { 'panel.roles': ['read'] })) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu n’as pas la permission de gérer les rôles.
      </p>
    );
  }

  const roles: RoleDto[] = query.data ?? [];
  const builtIns = roles.filter((role) => role.builtIn);
  const custom = roles.filter((role) => !role.builtIn);

  return (
    <div className="space-y-6">
      {/* ─── Built-in roles (read-only) ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Rôles intégrés</CardTitle>
          <CardDescription>
            Toujours disponibles, non modifiables : ils ancrent le panel
            (l’administrateur détient toutes les permissions, le rôle
            « Utilisateur » est la base de tout compte).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {builtIns.map((role) => (
            <div key={role.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{role.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {role.userCount} utilisateur(s) · {role.permissions.length} permission(s)
                  </p>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  Intégré
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {role.permissions.map((permission) => (
                  <span
                    key={permission}
                    className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {permission}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── Custom roles ─── */}
      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Créer un rôle</CardTitle>
            <CardDescription>
              Coche les permissions de ce rôle — un rôle ne peut accorder que
              ce que tu possèdes toi-même. Les rôles personnalisés n’ont
              jamais de permissions par serveur : celles-ci se gèrent par
              serveur (onglet « Utilisateurs » d’un serveur).
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              createForm.handleSubmit();
            }}
          >
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <createForm.Field name="name">
                  {(field) => (
                    <div className="space-y-2">
                      <Input
                        placeholder="Nom du rôle (ex : Support)"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </div>
                  )}
                </createForm.Field>
                <createForm.Field name="description">
                  {(field) => (
                    <div className="space-y-2">
                      <Input
                        placeholder="Description (optionnelle)"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </div>
                  )}
                </createForm.Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {PANEL_PERMISSION_GROUPS.map((group) => (
                  <div key={group.resource} className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">{group.label}</p>
                    {group.actions.map((entry) => (
                      <createForm.Field
                        key={entry.permission}
                        name={`permissions.${entry.permission}`}
                      >
                        {(field) => (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`create-role-${entry.permission}`}
                              checked={Boolean(field.state.value)}
                              onCheckedChange={(checked) =>
                                field.handleChange(checked === true)
                              }
                            />
                            <Label
                              htmlFor={`create-role-${entry.permission}`}
                              className="text-sm font-normal"
                            >
                              {entry.label}
                            </Label>
                          </div>
                        )}
                      </createForm.Field>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <createForm.Subscribe selector={(s) => [s.isSubmitting, create.isPending]}>
                {([isSubmitting, pending]) => (
                  <Button type="submit" disabled={isSubmitting || pending}>
                    <Plus />
                    {pending ? 'Création…' : 'Créer le rôle'}
                  </Button>
                )}
              </createForm.Subscribe>
            </CardFooter>
          </form>
        </Card>
      )}

      {custom.map((role) => (
        <CustomRoleCard
          key={role.id}
          role={role}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onSave={(value) =>
            update.mutate({
              roleId: role.id,
              name: value.name,
              description: value.description || undefined,
              permissions: value.permissions,
            })
          }
          onRemove={() => {
            if (
              confirm(
                `Supprimer le rôle « ${role.name} » ? ${role.userCount > 0 ? 'Il est encore attribué à des utilisateurs.' : ''}`,
              )
            ) {
              remove.mutate({ roleId: role.id });
            }
          }}
          pending={update.isPending || remove.isPending}
        />
      ))}

      {!query.isPending && custom.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun rôle personnalisé pour l’instant.
        </p>
      )}
    </div>
  );
}

/** One custom role: name/description inputs + inline permission editor + delete. */
function CustomRoleCard({
  role,
  canUpdate,
  canDelete,
  onSave,
  onRemove,
  pending,
}: {
  role: RoleDto;
  canUpdate: boolean;
  canDelete: boolean;
  onSave: (value: { name: string; description: string; permissions: PermissionStatements }) => void;
  onRemove: () => void;
  pending: boolean;
}) {
  const form = useForm({
    defaultValues: {
      name: role.name,
      description: role.description ?? '',
      permissions: Object.fromEntries(
        role.permissions.map((permission) => [permission, true]),
      ) as Record<string, boolean>,
    },
    onSubmit: ({ value }) => {
      const statements = checkedToStatements(value.permissions);
      if (Object.keys(statements).length === 0) {
        toast.error('Sélectionne au moins une permission');
        return;
      }
      onSave({ name: value.name, description: value.description, permissions: statements });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              <form.Field name="name">
                {(field) => (
                  <Input
                    className="h-7 w-56"
                    placeholder="Nom du rôle"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={!canUpdate}
                  />
                )}
              </form.Field>
            </CardTitle>
            <CardDescription className="mt-1">
              {role.userCount} utilisateur(s) · identifiant : {role.id}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {canUpdate && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => form.handleSubmit()}>
                <Save />
                Enregistrer
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="destructive" disabled={pending} onClick={onRemove}>
                <Trash2 />
                Supprimer
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form.Field name="description">
          {(field) => (
            <Input
              placeholder="Description (optionnelle)"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={!canUpdate}
            />
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {PANEL_PERMISSION_GROUPS.map((group) => (
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
                        id={`${role.id}-${entry.permission}`}
                        checked={Boolean(field.state.value)}
                        disabled={!canUpdate}
                        onCheckedChange={(checked) => field.handleChange(checked === true)}
                      />
                      <Label
                        htmlFor={`${role.id}-${entry.permission}`}
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
