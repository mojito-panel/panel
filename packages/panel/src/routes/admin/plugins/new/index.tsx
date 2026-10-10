import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { createPluginFn } from '~/server/functions/admin';
import { PluginEditor } from '~/components/plugin-editor/plugin-editor';
import {
  emptyPluginEditorValue,
  pluginEditorValueToPlugin,
  type PluginEditorValue,
} from '~/validators/plugin-editor';

export const Route = createFileRoute('/admin/plugins/new/')({
  component: NewPluginPage,
});

function NewPluginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createPlugin = useServerFn(createPluginFn);

  const mutation = useMutation({
    mutationFn: async (value: PluginEditorValue) => {
      const { plugin, issues } = pluginEditorValueToPlugin(value);
      if (!plugin) {
        throw new Error(`Plugin invalide : ${(issues ?? []).join(' · ')}`);
      }
      return createPlugin({ data: { json: JSON.stringify(plugin, null, 2) } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      await navigate({
        to: '/admin/plugins/$pluginId',
        params: { pluginId: result.id },
      });
    },
  });

  return (
    <PluginEditor
      title="Nouveau plugin"
      initial={emptyPluginEditorValue()}
      onSubmit={(value) => mutation.mutate(value)}
      submitPending={mutation.isPending}
      submitError={mutation.isError ? mutation.error.message : null}
    />
  );
}
