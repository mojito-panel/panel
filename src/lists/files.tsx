import { Download, File as FileIcon, Folder, Pencil, Trash2 } from 'lucide-react';

import { formatSize } from '~/components/files/format-size';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import type { FileObject } from '~/contract';
import { isEditableFile } from '~/lib/text-files';
import { defineList, field } from '~/lists/define';

/**
 * Directory listing of the file browser.
 *
 * The rows come from the agent (they are already in the browser when the
 * directory is fetched), so this list runs in `client` mode: the name filter,
 * the sorting and the paging all happen locally, with the same toolbar and the
 * same columns as every other list of the panel.
 */

/** Bulk selection state of the listing, supplied by the browser. */
export interface FilesSelection {
  /** Selected entry paths of the current directory. */
  selected: readonly string[];
  /** Whether every listed entry is selected (the header checkbox). */
  allSelected: boolean;
  /** Whether at least one listed entry is selected (the indeterminate state). */
  someSelected: boolean;
  onToggle: (path: string) => void;
  onToggleAll: () => void;
}

/** Row actions of the listing, supplied by the browser. */
export interface FilesContext {
  canWrite: boolean;
  canDelete: boolean;
  deleting: boolean;
  /**
   * Bulk selection — null hides the checkboxes (no delete grant, or a
   * context-less render like a picker).
   */
  selection: FilesSelection | null;
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
    select: {
      header: '',
      pinned: true,
      headerCell: (context) => {
        const selection = context?.selection;
        if (!selection) return null;
        return (
          <Checkbox
            checked={selection.allSelected}
            indeterminate={!selection.allSelected && selection.someSelected}
            onCheckedChange={() => selection.onToggleAll()}
            aria-label="Tout sélectionner"
          />
        );
      },
      cell: (entry, context) => {
        const selection = context?.selection;
        if (!selection) return null;
        return (
          <Checkbox
            checked={selection.selected.includes(entry.path)}
            onCheckedChange={() => selection.onToggle(entry.path)}
            aria-label={`Sélectionner ${entry.name}`}
          />
        );
      },
    },
    name: {
      header: 'Nom',
      sort: true,
      sortFn: 'text',
      // NOTE: the filter target is INERT in client mode — TanStack filters
      // on the column id (row value), never on the target. The declaration
      // type still requires one because the same `ListFilter` shape feeds
      // the server-side mapping (`server/list/query.ts`); making it
      // mode-optional would ripple into the server query builder. The
      // path mirrors the row key, kept for declaration symmetry.
      filter: { control: 'text', target: field('name') },
      cell: (entry, context) => (
        <button
          className="hover:bg-muted flex items-center gap-2 rounded px-2 py-1 text-left"
          onClick={() => context?.onOpen(entry)}
          title={
            entry.isDirectory ? 'Ouvrir' : isEditableFile(entry.name) ? 'Éditer' : 'Télécharger'
          }
        >
          {entry.isDirectory ? (
            <Folder className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <FileIcon className="text-muted-foreground size-4 shrink-0" />
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
