import { Download, File as FileIcon, Folder, Pencil, Trash2 } from 'lucide-react';
import { formatSize } from '~/components/files/format-size';
import { Button } from '~/components/ui/button';
import type { FileObject } from '~/contract';
import { defineList, field } from '~/lists/define';

/**
 * Directory listing of the file browser.
 *
 * The rows come from the agent (they are already in the browser when the
 * directory is fetched), so this list runs in `client` mode: the name filter,
 * the sorting and the paging all happen locally, with the same toolbar and the
 * same columns as every other list of the panel.
 */

/** Row actions of the listing, supplied by the browser. */
export interface FilesContext {
  canWrite: boolean;
  canDelete: boolean;
  deleting: boolean;
  onOpen: (entry: FileObject) => void;
  onDownload: (entry: FileObject) => void;
  onRename: (entry: FileObject) => void;
  onDelete: (entry: FileObject) => void;
}

export const filesList = defineList<FileObject, FilesContext>({
  name: 'files',
  alias: 'f',
  mode: 'client',
  defaultSort: { column: 'name', desc: false },
  columns: {
    name: {
      header: 'Nom',
      sort: true,
      sortFn: 'text',
      filter: { control: 'text', target: field('name') },
      cell: (entry, context) => (
        <button
          className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
          onClick={() => context?.onOpen(entry)}
          title={entry.isDirectory ? 'Ouvrir' : 'Éditer'}
        >
          {entry.isDirectory ? (
            <Folder className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      ),
    },
    sizeBytes: {
      header: 'Taille',
      sort: true,
      sortFn: 'alphanumeric',
      className: 'text-muted-foreground',
      cell: (entry) => (entry.isDirectory ? '—' : formatSize(entry.size)),
    },
    modifiedAt: {
      header: 'Modifié',
      sort: true,
      sortFn: 'datetime',
      className: 'text-muted-foreground',
      cell: (entry) =>
        entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString('fr-FR') : '—',
    },
    actions: {
      header: '',
      pinned: true,
      cell: (entry, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
        <div className="flex justify-end gap-1">
          {!entry.isDirectory && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Télécharger"
              onClick={() => context.onDownload(entry)}
            >
              <Download />
            </Button>
          )}
          {context.canWrite && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Renommer"
              onClick={() => context.onRename(entry)}
            >
              <Pencil />
            </Button>
          )}
          {context.canDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Supprimer"
              disabled={context.deleting}
              onClick={() => context.onDelete(entry)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ),
    },
  },
});
