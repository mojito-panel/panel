import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { listNodesFn, createNodeFn, deleteNodeFn } from '~/server/functions/admin';
import { createNodeSchema, type CreateNodeDto } from '~/validators/node';
import { buildAgentConfig } from '~/lib/agent-config';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/admin/nodes/')({
  component: AdminNodesPage,
});

function AdminNodesPage() {
  const queryClient = useQueryClient();
  const listNodes = useServerFn(listNodesFn);
  const createNode = useServerFn(createNodeFn);
  const deleteNode = useServerFn(deleteNodeFn);

  const query = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });

  const create = useMutation({
    mutationFn: async (data: CreateNodeDto) => {
      const result = await createNode({ data });
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      return result;
    },
  });

  const remove = useMutation({
    mutationFn: (nodeId: string) => deleteNode({ data: { nodeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const form = useForm({
    validators: { onChange: createNodeSchema },
    defaultValues: { name: '', fqdn: '', agentPort: 8080 },
    onSubmit: ({ value }) => create.mutate(value),
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Nodes</h1>
      <p className="text-muted-foreground">Machines hébergeant un agent Mojito.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un node</CardTitle>
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
                    <Label htmlFor="node-name">Nom</Label>
                    <Input
                      id="node-name"
                      placeholder="Windows-01"
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

              <form.Field name="fqdn">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="node-fqdn">FQDN / IP</Label>
                    <Input
                      id="node-fqdn"
                      placeholder="node1.example.com ou 192.168.1.10"
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

              <form.Field name="agentPort">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="node-port">Port agent</Label>
                    <Input
                      id="node-port"
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

              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? 'Création…' : 'Créer le node'}
              </Button>
            </form>

            {create.isError && (
              <p className="mt-2 text-sm text-destructive">{create.error.message}</p>
            )}

            {/* Agent config shown ONCE after creation — the token inside will
                never be displayed again */}
            {create.data?.agentToken && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
                <p className="font-semibold text-amber-800">
                  Copie cette configuration maintenant — le token ne sera plus jamais affiché.
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  Placer ce fichier <code>shard.yml</code> à côté de{' '}
                  <code>shard.exe</code> sur le node, puis démarrer l'agent.
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">
                  {buildAgentConfig(create.data)}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(buildAgentConfig(create.data!))
                      .then(() => toast.success('Configuration shard.yml copiée'))
                      .catch(() => toast.error('Copie impossible — sélectionne le texte manuellement'));
                  }}
                >
                  Copier la configuration
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {(query.data ?? []).map((node) => (
            <Link
              key={node.id}
              to="/admin/nodes/$nodeId"
              params={{ nodeId: node.id }}
              className="block rounded-lg border p-4 transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{node.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {node.fqdn}:{node.agentPort} · {node.status}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm(`Supprimer le node « ${node.name} » ?`)) {
                      remove.mutate(node.id);
                    }
                  }}
                >
                  Supprimer
                </Button>
              </div>
            </Link>
          ))}
          {query.data?.length === 0 && (
            <p className="text-muted-foreground">Aucun node enregistré.</p>
          )}
          {remove.isError && (
            <p className="text-sm text-destructive">{remove.error.message}</p>
          )}
        </div>
      </div>

      <p className="mt-8">
        <Button variant="ghost" asChild>
          <Link to="/servers">← Mes serveurs</Link>
        </Button>
      </p>
    </div>
  );
}
