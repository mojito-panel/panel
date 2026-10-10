import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { listPluginsFn, createPluginFn, deletePluginFn } from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/admin/plugins')({
  component: AdminPluginsPage,
});

function AdminPluginsPage() {
  const queryClient = useQueryClient();
  const listPlugins = useServerFn(listPluginsFn);
  const createPlugin = useServerFn(createPluginFn);
  const deletePlugin = useServerFn(deletePluginFn);

  const query = useQuery({ queryKey: ['plugins'], queryFn: () => listPlugins() });

  const create = useMutation({
    mutationFn: async (json: string) => {
      const result = await createPlugin({ data: { json } });
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      return result;
    },
  });

  const remove = useMutation({
    mutationFn: (pluginId: string) => deletePlugin({ data: { pluginId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Plugins</h1>
      <p className="text-muted-foreground">
        Eggs JSON (format v2, compatible Pelican-like) installables sur les serveurs.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Importer un plugin</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const json = String(formData.get('pluginJson') ?? '').trim();
                if (json) {
                  create.mutate(json);
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="pluginJson">JSON du plugin (schéma v2)</Label>
                <textarea
                  id="pluginJson"
                  name="pluginJson"
                  rows={12}
                  placeholder={'{\n  "schemaVersion": 2,\n  "id": "mon-plugin",\n  …'}
                  className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                />
              </div>
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? 'Import…' : 'Importer'}
              </Button>
            </form>

            {create.isError && (
              <p className="mt-2 text-sm text-destructive">{create.error.message}</p>
            )}
            {create.data && (
              <p className="mt-2 text-sm text-green-600">
                Plugin « {create.data.name} » importé.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {(query.data ?? []).map((plugin) => (
            <div key={plugin.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{plugin.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {plugin.slug} · v{plugin.schemaVersion} ·{' '}
                    {plugin.variables.length} variable(s)
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`Supprimer le plugin « ${plugin.name} » ?`)) {
                      remove.mutate(plugin.id);
                    }
                  }}
                >
                  Supprimer
                </Button>
              </div>
            </div>
          ))}
          {query.data?.length === 0 && (
            <p className="text-muted-foreground">Aucun plugin importé.</p>
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
    </main>
  );
}
