import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { Plus } from 'lucide-react';
import type { PluginVariable } from '@mojito/contract';
import { listNodesFn, listPluginsFn } from '~/server/functions/admin';
import { installServerFn } from '~/server/functions/servers';
import { createServerSchema, type CreateServerDto } from '~/validators/server';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { VariableField } from '~/components/variable-field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/_app/servers/new')({
  component: NewServerPage,
});

function NewServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listNodes = useServerFn(listNodesFn);
  const listPlugins = useServerFn(listPluginsFn);
  const installServer = useServerFn(installServerFn);

  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  const pluginsQuery = useQuery({ queryKey: ['plugins'], queryFn: () => listPlugins() });

  const nodes = nodesQuery.data ?? [];
  const plugins = pluginsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: async (data: CreateServerDto) => {
      const result = await installServer({ data });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      return result;
    },
    onSuccess: async (result) => {
      await navigate({
        to: '/servers/$serverId',
        params: { serverId: result.id },
      });
    },
  });

  const form = useForm({
    validators: { onChange: createServerSchema },
    defaultValues: {
      name: '',
      nodeId: '',
      pluginId: '',
      port: 25565,
      memoryMb: 2048,
      variables: {} as Record<string, string | number | boolean>,
    },
    onSubmit: ({ value }) => mutation.mutate(value),
  });

  const selectPlugin = (pluginId: string) => {
    form.setFieldValue('pluginId', pluginId);
    const plugin = plugins.find((p) => p.id === pluginId);
    for (const variable of plugin?.variables ?? []) {
      form.setFieldValue(`variables.${variable.env}`, variable.defaultValue);
    }
  };

  const renderVariableField = (variable: PluginVariable) => (
    <form.Field name={`variables.${variable.env}`} key={variable.env}>
      {(field) => (
        <VariableField
          variable={variable}
          value={field.state.value}
          onChange={field.handleChange}
          onBlur={field.handleBlur}
        />
      )}
    </form.Field>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">Nouveau serveur</h1>
      <p className="text-muted-foreground">
        Choisis un plugin, un node, et configure les variables.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Créer un serveur</CardTitle>
          <CardDescription>
            L'installation est déléguée à l'agent du node sélectionné.
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
                  <Label htmlFor="name">Nom du serveur</Label>
                  <Input
                    id="name"
                    placeholder="Mon serveur Minecraft"
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

            <form.Field name="nodeId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="nodeId">Node</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                  >
                    <SelectTrigger id="nodeId" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue placeholder="— Choisir un node —" />
                    </SelectTrigger>
                    <SelectContent>
                      {nodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.name} ({node.fqdn}:{node.agentPort})
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

            <form.Field name="pluginId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="pluginId">Plugin</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => selectPlugin(v)}
                  >
                    <SelectTrigger id="pluginId" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue placeholder="— Choisir un plugin —" />
                    </SelectTrigger>
                    <SelectContent>
                      {plugins.map((plugin) => (
                        <SelectItem key={plugin.id} value={plugin.id}>
                          {plugin.name}
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

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="port">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
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

              <form.Field name="memoryMb">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="memoryMb">RAM (Mo)</Label>
                    <Input
                      id="memoryMb"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
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
            </div>

            {/* Plugin variables — auto-generated form */}
            <form.Subscribe selector={(state) => state.values.pluginId}>
              {(pluginId) => {
                const plugin = plugins.find((p) => p.id === pluginId);
                const pluginVariables = (plugin?.variables ?? [])
                  .filter((v) => v.userViewable && v.userEditable)
                  .sort((a, b) => a.sort - b.sort);
                if (pluginVariables.length === 0) return null;
                return (
                  <div className="space-y-4 rounded-md border p-4">
                    <p className="text-sm font-semibold">Variables du plugin</p>
                    {pluginVariables.map((variable) => renderVariableField(variable))}
                  </div>
                );
              }}
            </form.Subscribe>

            {mutation.isError && (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              <Plus />
              {mutation.isPending ? 'Création…' : 'Créer et installer'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6">
        <Button variant="ghost" asChild>
          <Link to="/servers">← Mes serveurs</Link>
        </Button>
      </p>
    </div>
  );
}
