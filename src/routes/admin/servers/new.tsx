import { useForm, useStore } from '@tanstack/react-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Plus } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
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
import type { RecipeVariable } from '~/contract';
import { hasPermissions } from '~/lib/permissions';
import { adminServersList } from '~/lists/servers';
import {
  listNodesFn,
  listRecipeOptionsFn,
  listFreeNodeAllocationsFn,
} from '~/server/functions/admin';
import { installServerFn } from '~/server/functions/servers';
import { createServerSchema, type CreateServerDto } from '~/validators/server';

export const Route = createFileRoute('/admin/servers/new')({
  // The /admin layout already requires admin area access — this narrows it
  // to panel.servers.create: a moderator (read-only oversight) or a custom
  // role without the statement must NOT deploy. Mirrors the server-side
  // gate on installServerFn.
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } | null }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
    if (!hasPermissions(user.permissions ?? [], { 'panel.servers': ['create'] })) {
      throw redirect({ to: '/admin/servers', search: adminServersList.defaultSearch });
    }
  },
  component: NewServerPage,
});

function NewServerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listNodes = useServerFn(listNodesFn);
  const listRecipeOptions = useServerFn(listRecipeOptionsFn);
  const listFreeNodeAllocations = useServerFn(listFreeNodeAllocationsFn);
  const installServer = useServerFn(installServerFn);

  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  const recipesQuery = useQuery({
    queryKey: ['recipe-options'],
    queryFn: () => listRecipeOptions(),
  });

  const nodes = nodesQuery.data ?? [];
  const recipes = recipesQuery.data ?? [];

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
      recipeId: '',
      allocationId: '',
      memoryMb: 2048,
      cpuCores: 2,
      variables: {} as Record<string, string | number | boolean>,
    },
    onSubmit: ({ value }) => mutation.mutate(value),
  });

  // Free allocations of the selected node (Pelican deployment form: the
  // port is picked from the node's pool, not typed freely)
  const selectedNodeId = useStore(form.store, (state) => state.values.nodeId);
  const freeAllocationsQuery = useQuery({
    queryKey: ['node-free-allocations', selectedNodeId],
    queryFn: () => listFreeNodeAllocations({ data: { nodeId: selectedNodeId } }),
    enabled: !!selectedNodeId,
  });

  // Reset the picked allocation when the node changes — each node has its
  // own pool, the previous choice may not exist there
  const selectNode = (nodeId: string) => {
    form.setFieldValue('nodeId', nodeId);
    form.setFieldValue('allocationId', '');
  };

  const selectRecipe = (recipeId: string) => {
    form.setFieldValue('recipeId', recipeId);
    const recipe = recipes.find((p) => p.id === recipeId);
    for (const variable of recipe?.variables ?? []) {
      form.setFieldValue(`variables.${variable.env}`, variable.default_value);
    }
  };

  const renderVariableField = (variable: RecipeVariable) => (
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
        Choisis une recette, un node, et configure les variables.
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
                    <p className="text-destructive text-sm">
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
                    onValueChange={(v) => v !== null && selectNode(v)}
                    items={nodes.map((node) => ({
                      value: node.id,
                      label: `${node.name} (${node.fqdn}:${node.publicPort})`,
                    }))}
                  >
                    <SelectTrigger id="nodeId" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue placeholder="— Choisir un node —" />
                    </SelectTrigger>
                    <SelectContent>
                      {nodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.name} ({node.fqdn}:{node.publicPort})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="recipeId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="recipeId">Recette</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => v !== null && selectRecipe(v)}
                    items={recipes.map((recipe) => ({ value: recipe.id, label: recipe.name }))}
                  >
                    <SelectTrigger id="recipeId" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue placeholder="— Choisir une recette —" />
                    </SelectTrigger>
                    <SelectContent>
                      {recipes.map((recipe) => (
                        <SelectItem key={recipe.id} value={recipe.id}>
                          {recipe.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {/* Allocation picker — only enabled once the node is chosen
                (each node has its own pool) */}
            <form.Field name="allocationId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="allocationId">Allocation (IP:port)</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => v !== null && field.handleChange(v)}
                    items={(freeAllocationsQuery.data ?? []).map((a) => ({
                      value: a.id,
                      label: `${a.ip}:${a.port}${a.alias ? ` (${a.alias})` : ''}`,
                    }))}
                    disabled={!selectedNodeId}
                  >
                    <SelectTrigger id="allocationId" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue
                        placeholder={
                          selectedNodeId ? '— Choisir une allocation —' : 'Choisis d’abord un node'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(freeAllocationsQuery.data ?? []).map((allocation) => (
                        <SelectItem key={allocation.id} value={allocation.id}>
                          {allocation.ip}:{allocation.port}
                          {allocation.alias ? ` (${allocation.alias})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                  {selectedNodeId && (freeAllocationsQuery.data ?? []).length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      Aucune allocation libre sur ce node — demande à un administrateur d’en créer
                      dans la page du node.
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
                    min="0"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    onBlur={field.handleBlur}
                  />
                  <p className="text-muted-foreground text-xs">
                    0 = illimité (pas de limite de commit).
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="cpuCores">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="cpuCores">CPU (cœurs)</Label>
                  <Input
                    id="cpuCores"
                    type="number"
                    step="0.5"
                    min="0"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    onBlur={field.handleBlur}
                  />
                  <p className="text-muted-foreground text-xs">
                    Valeurs fractionnaires acceptées (ex. 1.5) — 0 = illimité.
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {/* Recipe variables — auto-generated form */}
            <form.Subscribe selector={(state) => state.values.recipeId}>
              {(recipeId) => {
                const recipe = recipes.find((p) => p.id === recipeId);
                const recipeVariables = (recipe?.variables ?? [])
                  .filter((v) => v.user_viewable && v.user_editable)
                  .sort((a, b) => a.sort - b.sort);
                if (recipeVariables.length === 0) return null;
                return (
                  <div className="space-y-4 rounded-md border p-4">
                    <p className="text-sm font-semibold">Variables de la recette</p>
                    {recipeVariables.map((variable) => renderVariableField(variable))}
                  </div>
                );
              }}
            </form.Subscribe>

            {mutation.isError && (
              <p className="text-destructive text-sm">{mutation.error.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              <Plus />
              {mutation.isPending ? 'Création…' : 'Créer et installer'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6">
        <Button
          variant="ghost"
          render={<Link to="/admin/servers" search={adminServersList.defaultSearch} />}
        >
          ← Serveurs
        </Button>
      </p>
    </div>
  );
}
