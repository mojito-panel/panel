import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';

import { getFileDownloadUrlFn } from '~/server/functions/files';
import { getServerFn } from '~/server/functions/servers';
import { hasServerPermissions } from '~/lib/permissions';
import { triggerDownload } from '~/components/download';
import { filesSearchSchema } from '~/validators/files';
import { FileBrowser } from '~/components/files/file-browser';
import { FileEditor } from '~/components/files/file-editor';

export const Route = createFileRoute('/servers/$serverId/files')({
  validateSearch: (search: Record<string, unknown>) => filesSearchSchema.parse(search),
  component: FilesPage,
});

/** Page — search params (?dir=…&file=…) make the browser deep-linkable. */
function FilesPage() {
  const { serverId } = Route.useParams();
  const { dir, file } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const getDownloadUrl = useServerFn(getFileDownloadUrlFn);
  // Shared server query (cached) — the viewer's per-server grants gate the
  // mutating controls (the server functions enforce them anyway)
  const getServer = useServerFn(getServerFn);
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];
  const canCreate = hasServerPermissions(permissions, { 'server.files': ['create'] });
  const canWrite = hasServerPermissions(permissions, { 'server.files': ['write'] });
  const canDelete = hasServerPermissions(permissions, { 'server.files': ['delete'] });
  // SFTP access follows the file grants (ANY server.files.* permission —
  // same rule as the /api/sftp/auth permission mapping)
  const sftp =
    serverQuery.data &&
    hasServerPermissions(
      serverQuery.data.viewer.permissions,
      { 'server.files': ['read', 'write', 'create', 'delete'] },
      'OR',
    )
      ? {
          fqdn: serverQuery.data.node.fqdn,
          sftpPort: serverQuery.data.node.sftpPort,
          serverId: serverQuery.data.id,
        }
      : null;

  const invalidateFiles = () =>
    queryClient.invalidateQueries({ queryKey: ['files', serverId] });

  const go = (targetDir: string, targetFile?: string) =>
    navigate({
      to: '/servers/$serverId/files',
      params: { serverId },
      search: { dir: targetDir, ...(targetFile ? { file: targetFile } : {}) },
    });

  /**
   * Triggers a browser download — a short-lived JWT makes the browser fetch
   * the bytes DIRECTLY from the agent (signed per path, like backups), so
   * binaries round-trip losslessly and the panel never proxies them.
   */
  async function download(path: string) {
    try {
      const { url } = await getDownloadUrl({ data: { serverId, path } });
      triggerDownload(url, path.split('/').pop() ?? 'fichier');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Téléchargement impossible');
    }
  }

  // Editor open (?file=…) → dedicated view
  if (file) {
    return (
      <FileEditor
        serverId={serverId}
        dir={dir}
        path={file}
        onClose={() => go(dir)}
        canSave={canWrite}
      />
    );
  }

  return (
    <div>
      <FileBrowser
        serverId={serverId}
        dir={dir}
        onNavigate={go}
        onRefresh={invalidateFiles}
        onDownload={download}
        canCreate={canCreate}
        canWrite={canWrite}
        canDelete={canDelete}
        sftp={sftp}
      />
    </div>
  );
}
