import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, Trash2 } from 'lucide-react';
import { parsePlugin } from '@mojito/contract';
import { getPluginFn, updatePluginFn, deletePluginFn } from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { PluginEditor } from '~/components/plugin-editor/plugin-editor';
import {
  pluginEditorValueToPlugin,
  pluginToEditorValue,
  type PluginEditorValue,
} from '~/validators/plugin-editor';

export const Route = createFileRoute('/admin/plugins/$pluginId/')({
  component: EditPluginPage,
});

function EditPluginPage() {
  const { pluginId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getPlugin = useServerFn(getPluginFn);
  const updatePlugin = useServerFn(updatePluginFn);
  const deletePlugin = useServerFn(deletePluginFn);

  const query = useQuery({
    queryKey: ['plugin', pluginId],
    queryFn: () => getPlugin({ data: { pluginId } }),
  });

  const update = useMutation({
    mutationFn: async (value: PluginEditorValue) => {
      const { plugin, issues } = pluginEditorValueToPlugin(value);
      if (!plugin) {
        throw new Error(`Plugin invalide : ${(issues ?? []).join(' · ')}`);
      }
      return updatePlugin({ data: { pluginId, json: JSON.stringify(plugin, null, 2) } });
    },
    onSuccess: async () => {
      // List only — ['plugin'] is NOT invalidated so the form keeps its state
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deletePlugin({ data: { pluginId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      await navigate({ to: '/admin/plugins' });
    },
  });

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement du plugin…</p>;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        <Button variant="ghost" asChild>
          <Link to="/admin/plugins">← Plugins</Link>
        </Button>
      </div>
    );
  }

  // Stored JSON → contract plugin (defaults applied) → editor value.
  // The whole page remounts via `key` when the server data changes.
  const initial = pluginToEditorValue(parsePlugin(JSON.parse(query.data.json)));

  /** Export: downloads the stored JSON (Pelican's ExportEggAction). */
  const exportPlugin = () => {
    const blob = new Blob([query.data?.json ?? ''], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plugin-${query.data?.slug ?? 'export'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <PluginEditor
      key={`${query.data.id}-${query.dataUpdatedAt}`}
      title={query.data.name}
      initial={initial}
      onSubmit={(value) => update.mutate(value)}
      submitPending={update.isPending}
      submitError={update.isError ? update.error.message : null}
      headerActions={
        <>
          <Button
            variant="outline"
            onClick={() => void exportPlugin()}
            title="Exporter le JSON du plugin"
          >
            <Download />
            Exporter
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Supprimer le plugin « ${query.data?.name} » ?`)) {
                remove.mutate();
              }
            }}
          >
            <Trash2 />
            Supprimer
          </Button>
        </>
      }
    />
  );
}
