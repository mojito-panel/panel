import { useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Pencil, Download, RefreshCw } from 'lucide-react';
import {
  listPluginsFn,
  importPluginsFn,
  getPluginFn,
  updatePluginFn,
  deletePluginFn,
} from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '~/components/ui/sheet';

export const Route = createFileRoute('/admin/plugins')({
  component: AdminPluginsPage,
});

type ImportMutationInput = { jsons: string[]; urls: string[] };

function AdminPluginsPage() {
  const queryClient = useQueryClient();
  const listPlugins = useServerFn(listPluginsFn);
  const importPlugins = useServerFn(importPluginsFn);
  const getPlugin = useServerFn(getPluginFn);
  const updatePlugin = useServerFn(updatePluginFn);
  const deletePlugin = useServerFn(deletePluginFn);

  const query = useQuery({ queryKey: ['plugins'], queryFn: () => listPlugins() });

  /** Plugin being edited (id), or null when the panel is closed. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const editingQuery = useQuery({
    queryKey: ['plugin', editing?.id],
    enabled: editing !== null,
    queryFn: () => getPlugin({ data: { pluginId: editing?.id ?? '' } }),
  });

  const importMutation = useMutation({
    mutationFn: (input: ImportMutationInput) => importPlugins({ data: input }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { pluginId: string; json: string }) => updatePlugin({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      await queryClient.invalidateQueries({ queryKey: ['plugin'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (pluginId: string) => deletePlugin({ data: { pluginId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });

  /** Batch import: textarea + .json files + URL (each optional). */
  const onImportSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const rawText = String(formData.get('pluginJson') ?? '').trim();
    const url = String(formData.get('pluginUrl') ?? '').trim();
    const files = formData
      .getAll('pluginFiles')
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (!rawText && !url && files.length === 0) return;

    const fileContents = await Promise.all(files.map((f) => f.text()));
    const jsons = [rawText, ...fileContents].filter((s) => s.length > 0);
    const urls = url ? [url] : [];

    importMutation.reset();
    importMutation.mutate({ jsons, urls });
    form.reset();
  };

  /** Re-import from the plugin's updateUrl (upsert — same behavior as Pelican). */
  const updateFromUrl = (url: string) => {
    importMutation.reset();
    importMutation.mutate({ jsons: [], urls: [url] });
  };

  /** Export: downloads the plugin's raw JSON. */
  const exportPlugin = async (pluginId: string, slug: string) => {
    const result = await getPlugin({ data: { pluginId } });
    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plugin-${slug}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onEditSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const json = String(new FormData(e.currentTarget).get('pluginJson') ?? '');
    updateMutation.mutate({ pluginId: editing.id, json });
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8">
      <h1 className="text-3xl font-bold tracking-tight">Plugins</h1>
      <p className="text-muted-foreground">
        Eggs JSON (format v2, compatible Pelican-like) installables sur les serveurs.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Importer des plugins</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onImportSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pluginJson">JSON (texte)</Label>
                <textarea
                  id="pluginJson"
                  name="pluginJson"
                  rows={8}
                  placeholder={'{\n  "schemaVersion": 2,\n  "id": "mon-plugin",\n  …'}
                  className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pluginFiles">Fichiers (.json)</Label>
                <input
                  id="pluginFiles"
                  name="pluginFiles"
                  type="file"
                  multiple
                  accept=".json,application/json"
                  className="flex w-full rounded-md border border-input bg-background p-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs file:text-secondary-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pluginUrl">Depuis une URL</Label>
                <Input
                  id="pluginUrl"
                  name="pluginUrl"
                  type="url"
                  placeholder="https://github.com/…/blob/…/plugin.json"
                />
                <p className="text-xs text-muted-foreground">
                  Les URLs GitHub (blob) sont converties en raw automatiquement.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? 'Import…' : 'Importer'}
              </Button>
            </form>

            {importMutation.isError && (
              <p className="mt-2 text-sm text-destructive">{importMutation.error.message}</p>
            )}

            {importMutation.data && (
              <div className="mt-3 space-y-2 text-sm">
                {importMutation.data.imported.length > 0 && (
                  <ul className="space-y-1 text-green-600">
                    {importMutation.data.imported.map((p) => (
                      <li key={`${p.slug}-${p.source}`}>
                        « {p.name} » ({p.slug}) — {p.created ? 'créé' : 'mis à jour'}
                      </li>
                    ))}
                  </ul>
                )}
                {importMutation.data.failed.length > 0 && (
                  <ul className="space-y-1 text-destructive">
                    {importMutation.data.failed.map((f) => (
                      <li key={f.source}>
                        {f.source} : {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {(query.data ?? []).map((plugin) => (
            <div key={plugin.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{plugin.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {plugin.slug} · v{plugin.schemaVersion} ·{' '}
                    {plugin.variables.length} variable(s)
                  </p>
                  {plugin.updateUrl && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      MAJ : {plugin.updateUrl}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {plugin.updateUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Re-importer depuis l'URL de mise à jour"
                      disabled={importMutation.isPending}
                      onClick={() => updateFromUrl(plugin.updateUrl as string)}
                    >
                      <RefreshCw />
                      Mettre à jour
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ id: plugin.id, name: plugin.name })}
                  >
                    <Pencil />
                    Éditer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void exportPlugin(plugin.id, plugin.slug)}
                  >
                    <Download />
                    Exporter
                  </Button>
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

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>Éditer « {editing?.name} »</SheetTitle>
            <SheetDescription>
              Le JSON complet est revalidé (schéma v2). L'id peut être modifié —
              l'unicité du slug est revérifiée.
            </SheetDescription>
          </SheetHeader>

          {editingQuery.data && (
            <form
              key={editingQuery.data.id}
              onSubmit={onEditSubmit}
              className="flex flex-1 flex-col gap-4 p-6 pt-0"
            >
              <textarea
                name="pluginJson"
                rows={22}
                defaultValue={editingQuery.data.json}
                className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
              />
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
              {updateMutation.isError && (
                <p className="text-sm text-destructive">{updateMutation.error.message}</p>
              )}
            </form>
          )}
          {editingQuery.isLoading && (
            <p className="p-6 text-sm text-muted-foreground">Chargement du plugin…</p>
          )}
        </SheetContent>
      </Sheet>

      <p className="mt-8">
        <Button variant="ghost" asChild>
          <Link to="/servers">← Mes serveurs</Link>
        </Button>
      </p>
    </main>
  );
}
