import { Copy, Trash2 } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { publicKeyTypeLabel } from '~/lib/ssh-key';
import { defineList, field } from '~/lists/define';

/**
 * /admin/keys — the SSH key pairs of the panel (deploy keys of the private
 * repositories). The SAME declaration feeds the page AND the DataPicker of
 * the marketplace registry forms (fetchPage = the page's server function),
 * so filtering/sorting/pagination run in the database for both.
 */

/** Row of the keys list (what the server function returns). */
export interface AdminSshKeyRow {
  id: string;
  name: string;
  /** Key type — e.g. "ssh-ed25519" (derived from the public key). */
  type: string;
  fingerprint: string;
  /** Trailing comment of the public key line (null when none). */
  comment: string | null;
  /** Full public key line — NOT a secret (copyable, to authorize the key). */
  publicKey: string;
  createdAt: Date;
}

/** Row actions of the keys list, supplied by the page. */
export interface AdminSshKeysContext {
  deleting: boolean;
  onDelete: (key: AdminSshKeyRow) => void;
}

export const adminSshKeysList = defineList<AdminSshKeyRow, AdminSshKeysContext>({
  name: 'admin-ssh-keys',
  alias: 'k',
  defaultSort: { column: 'name', desc: false },
  searchTargets: ['name'],
  columns: {
    name: {
      header: 'Clé',
      sort: field('name'),
      filter: { control: 'text', target: field('name') },
      cell: (key) => (
        <div>
          <p className="font-medium">{key.name}</p>
          {key.comment && (
            <p className="text-muted-foreground max-w-xs truncate text-xs" title={key.comment}>
              {key.comment}
            </p>
          )}
        </div>
      ),
    },
    type: {
      header: 'Type',
      // Display-only: the type is derived from the public key at read time
      // (no SQL path — not filterable/sortable).
      cell: (key) => <Badge variant="secondary">{publicKeyTypeLabel(key.type)}</Badge>,
    },
    fingerprint: {
      header: 'Empreinte',
      cell: (key) => (
        <span
          className="text-muted-foreground block max-w-[14rem] truncate font-mono text-xs"
          title={key.fingerprint}
        >
          {key.fingerprint}
        </span>
      ),
    },
    createdAt: {
      header: 'Créée le',
      sort: field('createdAt'),
      cell: (key) => (
        <span className="text-muted-foreground">{key.createdAt.toLocaleDateString('fr-FR')}</span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (key, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              title="Copier la clé publique"
              onClick={() => void navigator.clipboard.writeText(key.publicKey)}
            >
              <Copy />
              Copier la clé publique
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={context.deleting}
              onClick={() => context.onDelete(key)}
            >
              <Trash2 />
              Supprimer
            </Button>
          </div>
        ),
    },
  },
});
