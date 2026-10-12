import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState, type ChangeEvent } from 'react';
import {
  ArrowUp,
  Download,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';

import { MAX_UPLOAD_SIZE, type FileObject } from '~/contract';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { SftpConnectionDialog } from '~/components/sftp-card';
import {
  listFilesFn,
  createEntryFn,
  renameEntryFn,
  deleteEntriesFn,
  uploadFileFn,
} from '~/server/functions/files';
import { CreateEntryForm } from './create-entry-form';
import { RenameEntryForm } from './rename-entry-form';
import { FileTableSkeleton } from './file-table-skeleton';
import { FileErrorState } from './file-error-state';
import { formatSize } from './format-size';

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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      {/* Listing — one card wrapping the whole table */}
      <Card className="mt-4 py-0">
        <CardContent className="p-0">
          {query.isPending && <FileTableSkeleton />}

          {query.isError && (
            <FileErrorState
              bare
              message={query.error.message}
              onRetry={() => query.refetch()}
            />
          )}

          {query.data &&
            (query.data.files.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <FolderOpen className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Dossier vide</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pl-4 pr-4 font-medium">Nom</th>
                    <th className="py-2 pr-4 font-medium">Taille</th>
                    <th className="py-2 pr-4 font-medium">Modifié</th>
                    <th className="py-2 pr-4 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dir && (
                    <tr className="border-b">
                      <td colSpan={4} className="py-2 pl-4 pr-4">
                        <button
                          className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                          onClick={() => onNavigate(segments.slice(0, -1).join('/'))}
                        >
                          <ArrowUp className="size-4" />
                          ..
                        </button>
                      </td>
                    </tr>
                  )}
                  {query.data.files.map((entry) =>
                    renaming === entry.path ? (
                      <RenameEntryForm
                        key={entry.path}
                        currentName={entry.name}
                        pending={rename.isPending}
                        onCancel={() => setRenaming(null)}
                        onSubmit={(values) =>
                          rename.mutate({ path: entry.path, newName: values.name })
                        }
                      />
                    ) : (
                      <tr key={entry.path} className="border-b hover:bg-muted/40">
                        <td className="py-2 pl-4 pr-4">
                          <button
                            className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
                            onClick={() => open(entry)}
                            title={entry.isDirectory ? 'Ouvrir' : 'Éditer'}
                          >
                            {entry.isDirectory ? (
                              <Folder className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{entry.name}</span>
                          </button>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {entry.isDirectory ? '—' : formatSize(entry.size)}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {entry.modifiedAt
                            ? new Date(entry.modifiedAt).toLocaleString('fr-FR')
                            : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex justify-end gap-1">
                            {!entry.isDirectory && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="Télécharger"
                                onClick={() => onDownload(entry.path)}
                              >
                                <Download />
                              </Button>
                            )}
                            {canWrite && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="Renommer"
                                onClick={() => setRenaming(entry.path)}
                              >
                                <Pencil />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="Supprimer"
                                onClick={() => askDelete(entry)}
                                disabled={remove.isPending}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
