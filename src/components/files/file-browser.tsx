import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState, type ChangeEvent } from 'react';
import { ArrowUp, FilePlus, FolderPlus, Upload } from 'lucide-react';

import { MAX_UPLOAD_SIZE, type FileObject } from '~/contract';
import { ListTable } from '~/components/data-table/list-table';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { SftpConnectionDialog } from '~/components/sftp-card';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { filesList } from '~/lists/files';
import {
  listFilesFn,
  createEntryFn,
  renameEntryFn,
  deleteEntriesFn,
  uploadFileFn,
} from '~/server/functions/files';
import { CreateEntryForm } from './create-entry-form';
import { RenameEntryDialog } from './rename-entry-dialog';
import { ErrorState } from '~/components/error/error-state';

/** Directory listing — toolbar + breadcrumb + the listing table inside a card. */
export function FileBrowser({
  serverId,
  dir,
  onNavigate,
  onRefresh,
  onDownload,
  canCreate,
  canWrite,
  canDelete,
  sftp,
}: {
  serverId: string;
  dir: string;
  onNavigate: (dir: string, file?: string) => void;
  onRefresh: () => void;
  onDownload: (path: string) => void;
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
  /** SFTP connection details — null hides the toolbar button (no file grant). */
  sftp: { fqdn: string; sftpPort: number; serverId: string } | null;
}) {
  const listFiles = useServerFn(listFilesFn);
  const createEntry = useServerFn(createEntryFn);
  const renameEntry = useServerFn(renameEntryFn);
  const deleteEntries = useServerFn(deleteEntriesFn);
  const uploadFile = useServerFn(uploadFileFn);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<FileObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Table state of the listing (client mode: filtered/sorted/paginated locally). */
  const [tableQuery, setTableQuery] = useState<ListQuery>(filesList.defaultSearch);

  const query = useQuery({
    queryKey: ['files', serverId, dir],
    queryFn: () => listFiles({ data: { serverId, path: dir } }),
  });

  const create = useMutation({
    mutationFn: (data: { name: string; type: 'file' | 'directory' }) =>
      createEntry({ data: { serverId, directory: dir, name: data.name, type: data.type } }),
    onSuccess: () => {
      setCreating(false);
      setError(null);
      onRefresh();
    },
    onError: (err) => setError(err.message),
  });

  const rename = useMutation({
    mutationFn: (data: { path: string; newName: string }) =>
      renameEntry({ data: { serverId, path: data.path, newName: data.newName } }),
    onSuccess: () => {
      setRenaming(null);
      setError(null);
      onRefresh();
    },
    onError: (err) => {
      setRenaming(null);
      setError(err.message);
    },
  });

  const remove = useMutation({
    mutationFn: (paths: string[]) => deleteEntries({ data: { serverId, paths } }),
    onSuccess: () => {
      setError(null);
      onRefresh();
    },
    onError: (err) => setError(err.message),
  });

  const upload = useMutation({
    mutationFn: (data: { filename: string; contentBase64: string }) =>
      uploadFile({
        data: { serverId, directory: dir, filename: data.filename, contentBase64: data.contentBase64 },
      }),
    onSuccess: () => {
      setError(null);
      onRefresh();
    },
    onError: (err) => setError(err.message),
  });

  /** Upload input — read as dataURL to get the base64 payload. */
  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_SIZE) {
      setError(`Fichier trop volumineux (max ${Math.floor(MAX_UPLOAD_SIZE / 1024 / 1024)} Mo)`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      upload.mutate({ filename: file.name, contentBase64: dataUrl.split(',')[1] ?? '' });
    };
    reader.onerror = () => setError('Lecture du fichier impossible');
    reader.readAsDataURL(file);
  };

  const open = (entry: FileObject) => {
    if (entry.isDirectory) onNavigate(entry.path);
    else onNavigate(dir, entry.path);
  };

  const askDelete = (entry: FileObject) => {
    if (confirm(`Supprimer « ${entry.name} »${entry.isDirectory ? ' et son contenu' : ''} ?`)) {
      remove.mutate([entry.path]);
    }
  };

  const segments = dir ? dir.split('/') : [];

  return (
    <div>
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button
            className="rounded px-2 py-1 hover:bg-muted"
            onClick={() => onNavigate('')}
          >
            Racine
          </button>
          {segments.map((segment, index) => (
            <span key={segments.slice(0, index + 1).join('/')} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <button
                className="rounded px-2 py-1 hover:bg-muted"
                onClick={() => onNavigate(segments.slice(0, index + 1).join('/'))}
              >
                {segment}
              </button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap gap-2">
          {sftp && (
            <SftpConnectionDialog
              fqdn={sftp.fqdn}
              sftpPort={sftp.sftpPort}
              serverId={sftp.serverId}
            />
          )}
          {canCreate && (
            <>
              <input
                id="mojito-file-upload"
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={upload.isPending}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => document.getElementById('mojito-file-upload')?.click()}
              >
                <Upload />
                {upload.isPending ? 'Envoi…' : 'Uploader'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCreating((v) => !v)}>
                <FolderPlus />
                Nouveau dossier
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCreating((v) => !v)}>
                <FilePlus />
                Nouveau fichier
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {/* Create entry (name + type) */}
      {creating && (
        <CreateEntryForm
          pending={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(values) => create.mutate(values)}
        />
      )}

      {/* Listing — one card wrapping the toolbar + the shared table */}
      <Card className="mt-4 py-0">
        <CardContent className="p-0">
          {dir && (
            <div className="border-b px-3 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate(segments.slice(0, -1).join('/'))}
              >
                <ArrowUp />
                ..
              </Button>
            </div>
          )}

          {query.isError ? (
            <ErrorState bare message={query.error.message} onRetry={() => query.refetch()} />
          ) : (
            <div className="p-3">
              <ListTable
                list={filesList}
                rows={query.data?.files ?? []}
                search={tableQuery}
                onSearchChange={(patch) =>
                  setTableQuery((previous) => mergeQuery(previous, patch))
                }
                isPending={query.isPending}
                emptyMessage="Dossier vide"
                rowContext={{
                  canWrite,
                  canDelete,
                  deleting: remove.isPending,
                  onOpen: open,
                  onDownload: (entry) => onDownload(entry.path),
                  onRename: (entry) => setRenaming(entry),
                  onDelete: askDelete,
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <RenameEntryDialog
        entry={renaming}
        pending={rename.isPending}
        onClose={() => setRenaming(null)}
        onSubmit={(values) => {
          if (renaming) rename.mutate({ path: renaming.path, newName: values.name });
        }}
      />
    </div>
  );
}
