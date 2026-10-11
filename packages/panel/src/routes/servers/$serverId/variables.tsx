import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import type { RecipeVariable } from '@mojito/contract';
import { getServerFn, updateServerVariablesFn } from '~/server/functions/servers';
import { makeUpdateServerVariablesSchema } from '~/validators/server';
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

function ServerVariablesPage() {
  const { serverId } = Route.useParams();
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
  const updateVariables = useServerFn(updateServerVariablesFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });

  const server = query.data;

  const mutation = useMutation({
    mutationFn: async (variables: Record<string, string | number | boolean>) => {
      const result = await updateVariables({ data: { serverId, variables } });
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

  if (query.isError) {
    return <p className="text-sm text-destructive">Erreur : {query.error.message}</p>;
  }

  if (!server) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const definitions = [...(server.recipe.variables ?? [])].sort((a, b) => a.sort - b.sort);
  const editable = definitions.filter((v) => v.userViewable && v.userEditable);
  const readonly = definitions.filter((v) => v.userViewable && !v.userEditable);
  const defaults = new Map(definitions.map((v) => [v.env, v.defaultValue]));

  const form = useForm({
    validators: { onChange: makeUpdateServerVariablesSchema(definitions) },
    defaultValues: {
      serverId,
      variables: Object.fromEntries(
        definitions.map((v) => [v.env, server.variables[v.env] ?? v.defaultValue]),
      ) as Record<string, string | number | boolean>,
    },
    onSubmit: ({ value }) => mutation.mutate(value.variables),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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

            <Button type="submit" disabled={editable.length === 0 || mutation.isPending}>
              <Save />
              {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ─── Read-only variables (userViewable, not userEditable) ─── */}
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
                value={server.variables[variable.env] ?? variable.defaultValue}
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
                {resolveCommand(server.recipe.start.command, variables, defaults)}
              </pre>
            )}
          </form.Subscribe>
        </CardContent>
      </Card>
    </div>
  );
}
