import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';

import { readFileFn } from '~/server/functions/files';
import { getServerFn } from '~/server/functions/servers';
import { serverCan } from '~/lib/permissions';
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

  const readFile = useServerFn(readFileFn);

  // Shared server query (cached) — the viewer's per-server grants gate the
  // mutating controls (the server functions enforce them anyway)
  const getServer = useServerFn(getServerFn);
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];
  const canCreate = serverCan(permissions, { 'server.files': ['create'] });
  const canWrite = serverCan(permissions, { 'server.files': ['write'] });
  const canDelete = serverCan(permissions, { 'server.files': ['delete'] });
  // SFTP access follows the file grants (ANY server.files.* permission —
  // same rule as the /api/sftp/auth permission mapping)
  const sftp =
    serverQuery.data &&
    serverCan(
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

  /** Reads the content server-side then triggers a browser download (text). */
  async function download(path: string) {
    const data = await readFile({ data: { serverId, path } });
    const blob = new Blob([data.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() ?? 'fichier';
    a.click();
    URL.revokeObjectURL(url);
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
