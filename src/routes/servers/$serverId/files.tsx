import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ArrowUp,
  Download,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { MAX_UPLOAD_SIZE, type FileObject } from '~/contract';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  listFilesFn,
  readFileFn,
  saveFileFn,
  createEntryFn,
  renameEntryFn,
  deleteEntriesFn,
  uploadFileFn,
} from '~/server/functions/files';
import { getServerFn } from '~/server/functions/servers';
import { serverCan } from '~/lib/permissions';
import { SftpConnectionDialog } from '~/components/sftp-card';
import {
  filesSearchSchema,
  createEntryFormSchema,
  renameEntryFormSchema,
  saveFileFormSchema,
} from '~/validators/files';

export const Route = createFileRoute('/servers/$serverId/files')({
  validateSearch: (search: Record<string, unknown>) => filesSearchSchema.parse(search),
  component: FilesPage,
});

/** Human-readable size (Ko/Mo/Go, base 1024). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

/** ─── Page — search params (?dir=…&file=…) make the browser deep-linkable ─── */
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

/** ─── Directory listing (toolbar + table + inline forms) ─────────────────── */
function FileBrowser({
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
      {query.isError && (
        <p className="mt-3 text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {/* Create entry (name + type) */}
      {creating && (
        <CreateEntryForm
          pending={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(values) => create.mutate(values)}
        />
      )}

      {/* Listing */}
      {query.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Nom</th>
              <th className="py-2 pr-4 font-medium">Taille</th>
              <th className="py-2 pr-4 font-medium">Modifié</th>
              <th className="py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dir && (
              <tr className="border-b">
                <td colSpan={4} className="py-2">
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
            {query.data?.files.map((entry) =>
              renaming === entry.path ? (
                <RenameEntryForm
                  key={entry.path}
                  currentName={entry.name}
                  pending={rename.isPending}
                  onCancel={() => setRenaming(null)}
                  onSubmit={(values) => rename.mutate({ path: entry.path, newName: values.name })}
                />
              ) : (
                <tr key={entry.path} className="border-b hover:bg-muted/40">
                  <td className="py-2 pr-4">
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
                    {entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString('fr-FR') : '—'}
                  </td>
                  <td className="py-2">
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
            {query.data?.files.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  Dossier vide
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** ─── Create form (TanStack Form + Zod) ──────────────────────────────────── */
function CreateEntryForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; type: 'file' | 'directory' }) => void;
}) {
  const form = useForm({
    validators: { onChange: createEntryFormSchema },
    defaultValues: { name: '', type: 'file' as 'file' | 'directory' },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
    >
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1">
            <Input
              id="new-entry-name"
              placeholder="nom"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              autoFocus
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{field.state.meta.errors[0]?.message}</p>
            )}
          </div>
        )}
      </form.Field>
      <form.Field name="type">
        {(field) => (
          <Select
            value={field.state.value}
            onValueChange={(v) => field.handleChange(v as 'file' | 'directory')}
          >
            <SelectTrigger id="new-entry-type" className="w-full" onBlur={field.handleBlur}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="file">Fichier</SelectItem>
              <SelectItem value="directory">Dossier</SelectItem>
            </SelectContent>
          </Select>
        )}
      </form.Field>
      <Button type="submit" size="sm" disabled={pending}>
        <Save />
        Créer
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        <X />
        Annuler
      </Button>
    </form>
  );
}

/** ─── Inline rename row (TanStack Form + Zod) ────────────────────────────── */
function RenameEntryForm({
  currentName,
  pending,
  onCancel,
  onSubmit,
}: {
  currentName: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string }) => void;
}) {
  const form = useForm({
    validators: { onChange: renameEntryFormSchema },
    defaultValues: { name: currentName },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <tr className="border-b">
      <td colSpan={4} className="py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <form.Field name="name">
            {(field) => (
              <div className="space-y-1">
                <Input
                  placeholder="nouveau nom"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  autoFocus
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>
          <Button type="submit" size="sm" disabled={pending}>
            <Save />
            Renommer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X />
            Annuler
          </Button>
        </form>
      </td>
    </tr>
  );
}

/** ─── Text editor (read → edit → save) ───────────────────────────────────── */
function FileEditor({
  serverId,
  dir,
  path,
  onClose,
  canSave,
}: {
  serverId: string;
  dir: string;
  path: string;
  onClose: () => void;
  canSave: boolean;
}) {
  const readFile = useServerFn(readFileFn);
  const saveFile = useServerFn(saveFileFn);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['file', serverId, path],
    queryFn: () => readFile({ data: { serverId, path } }),
  });

  const save = useMutation({
    mutationFn: (content: string) => saveFile({ data: { serverId, path, content } }),
    onSuccess: () => setError(null),
    onError: (err) => setError(err.message),
  });

  if (query.isPending) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Chargement de « {path} »…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <p className="mb-4 text-sm text-destructive">Erreur : {query.error.message}</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          ← Retour
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          ← Retour
        </Button>
        <span className="text-sm font-medium">{path}</span>
        <span className="text-xs text-muted-foreground">({formatSize(query.data.size)})</span>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <SaveFileForm
        key={path}
        initialContent={query.data.content}
        pending={save.isPending}
        canSave={canSave}
        onSubmit={(content) => save.mutate(content)}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Dossier : {dir || 'racine'} — l’éditeur est réservé aux fichiers texte (max 1 Mo).
      </p>
    </div>
  );
}

/** Editor textarea (TanStack Form + Zod) — keyed by path to reset on file change. */
function SaveFileForm({
  initialContent,
  pending,
  canSave,
  onSubmit,
}: {
  initialContent: string;
  pending: boolean;
  /** false → read-only view (sub-user without server.files.write). */
  canSave: boolean;
  onSubmit: (content: string) => void;
}) {
  const form = useForm({
    validators: { onChange: saveFileFormSchema },
    defaultValues: { content: initialContent },
    onSubmit: ({ value }) => onSubmit(value.content),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="mt-4"
    >
      <form.Field name="content">
        {(field) => (
          <textarea
            className="h-[60vh] w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            spellCheck={false}
          />
        )}
      </form.Field>
      <div className="mt-3">
        {canSave ? (
          <Button type="submit" disabled={pending}>
            <Save />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Lecture seule — tu n’as pas la permission de modifier ce fichier.
          </p>
        )}
      </div>
    </form>
  );
}
