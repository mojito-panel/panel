import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import type { RecipeVariable } from '~/contract';
import { getServerFn, updateServerVariablesFn } from '~/server/functions/servers';
import { makeUpdateServerVariablesSchema } from '~/validators/server';
import { ErrorState, PageSkeleton } from '~/components/error/error-state';
import { serverCan } from '~/lib/permissions';
import { Button } from '~/components/ui/button';
import { VariableField } from '~/components/variable-field';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

/** /servers/$serverId/variables — variables du serveur (ex-"Démarrage"). */
export const Route = createFileRoute('/servers/$serverId/variables')({
  component: ServerVariablesPage,
});

/** System variables ({{SERVER_UUID}}…) are agent-side — shown as-is. */
const SYSTEM_ENV_PREFIX = 'SERVER_';

/**
 * Resolves the recipe's start command with the CURRENT variable values
 * (form value > recipe default). System variables stay literal — only the
 * agent can resolve them. Pelican equivalent: the read-only startup
 * command box.
 */
function resolveCommand(
  command: string,
  variables: Record<string, string | number | boolean>,
  defaults: Map<string, string | number | boolean>,
): string {
  return command.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, env: string) => {
    if (env.startsWith(SYSTEM_ENV_PREFIX) && !variables[env] && !defaults.has(env)) {
      return full;
    }
    const value = variables[env] ?? defaults.get(env);
    return value === undefined ? full : String(value);
  });
}

/**
 * The page itself keeps a STABLE hook count across renders (query hooks
 * only) — the form lives in the child below, which mounts once the data
 * exists. The previous single-component version called `useForm` after
 * data-dependent early returns: a render that resolved the query in
 * between rendered more hooks than the previous one and crashed React
 * ("Rendered more hooks than during the previous render").
 */
function ServerVariablesPage() {
  const { serverId } = Route.useParams();
  const getServer = useServerFn(getServerFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });

  if (query.isError) {
    return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />;
  }

  if (query.isPending) {
    return <PageSkeleton />;
  }

  const server = query.data;

  // Sub-user without the server.variables.read grant — the command and the
  // variable values are not even sent by the server function
  if (
    !server.recipe.start ||
    !serverCan(server.viewer.permissions, { 'server.variables': ['read'] })
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu n’as pas la permission de voir les variables de ce serveur.
      </p>
    );
  }

  return (
    <VariablesEditor
      serverId={serverId}
      variables={server.variables}
      // Narrowed above (recipe.start is null without server.variables.read)
      start={server.recipe.start}
      definitions={[...(server.recipe.variables ?? [])].sort((a, b) => a.sort - b.sort)}
      canUpdate={serverCan(server.viewer.permissions, { 'server.variables': ['update'] })}
    />
  );
}

/** Props of the editor (one stable snapshot of the server detail). */
interface VariablesEditorProps {
  serverId: string;
  variables: Record<string, string | number | boolean>;
  start: { command: string };
  definitions: RecipeVariable[];
  canUpdate: boolean;
}

/** Form + cards — mounts only with the data present, hooks unconditional. */
function VariablesEditor({ serverId, variables, start, definitions, canUpdate }: VariablesEditorProps) {
  const queryClient = useQueryClient();
  const updateVariables = useServerFn(updateServerVariablesFn);

  const editable = definitions.filter((v) => v.user_viewable && v.user_editable);
  const readonly = definitions.filter((v) => v.user_viewable && !v.user_editable);
  const defaults = new Map(definitions.map((v) => [v.env, v.default_value]));

  const mutation = useMutation({
    mutationFn: async (submitted: Record<string, string | number | boolean>) => {
      const result = await updateVariables({ data: { serverId, variables: submitted } });
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      return result;
    },
    onSuccess: () => {
      toast.success('Variables enregistrées', {
        description: 'Appliquées au prochain démarrage du serveur.',
      });
    },
    onError: (error) => {
      toast.error('Échec de l’enregistrement', { description: error.message });
    },
  });

  const form = useForm({
    validators: { onChange: makeUpdateServerVariablesSchema(definitions) },
    defaultValues: {
      serverId,
      variables: Object.fromEntries(
        definitions.map((v) => [v.env, variables[v.env] ?? v.default_value]),
      ) as Record<string, string | number | boolean>,
    },
    onSubmit: ({ value }) => mutation.mutate(value.variables),
  });

  return (
    <div className="space-y-6">
      {/* ─── Editable variables (Pelican: "Startup" > variable list) ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
          <CardDescription>
            Ces valeurs alimentent la commande de démarrage et les fichiers de
            configuration générés par la recette. Elles s'appliquent au prochain
            démarrage du serveur.
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
            {editable.length > 0 ? (
              editable.map((variable) => (
                <form.Field name={`variables.${variable.env}`} key={variable.env}>
                  {(field) => (
                    <VariableField
                      variable={variable}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      error={field.state.meta.errors[0]?.message as string | undefined}
                    />
                  )}
                </form.Field>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Cette recette n'a aucune variable éditable.
              </p>
            )}

            <Button
              type="submit"
              disabled={editable.length === 0 || mutation.isPending || !canUpdate}
            >
              <Save />
              {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ─── Read-only variables (user_viewable, not user_editable) ─── */}
      {readonly.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Variables en lecture seule</CardTitle>
            <CardDescription>
              Définies par l'administrateur via la recette — non modifiables
              ici.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {readonly.map((variable) => (
              <VariableField
                key={variable.env}
                variable={variable}
                value={variables[variable.env] ?? variable.default_value}
                onChange={() => {}}
                disabled
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Resolved start command (Pelican: read-only startup box) ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Commande de démarrage</CardTitle>
          <CardDescription>
            Résolue avec les valeurs actuelles — lecture seule, définie par le
            recette. Les variables système ({'{{SERVER_…}}'}) sont injectées par
            l'agent au démarrage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form.Subscribe selector={(s) => s.values.variables}>
            {(variables) => (
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
                {resolveCommand(start.command, variables, defaults)}
              </pre>
            )}
          </form.Subscribe>
        </CardContent>
      </Card>
    </div>
  );
}
