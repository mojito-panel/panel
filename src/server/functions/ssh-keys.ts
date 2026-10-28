import { createServerFn } from '@tanstack/react-start';
import { SshKey } from '~/db/entities';
import { listQueryBuilder, runListQuery } from '../list/query';
import { requirePanelPermission } from '../session';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import {
  deleteSshKey,
  generateSshKey,
  importSshKey,
} from '../ssh-keys';
import { createSshKeySchema, sshKeyIdSchema } from '~/validators/ssh-keys';
import { adminSshKeysList, type AdminSshKeyRow } from '~/lists/ssh-keys';

/**
 * SSH keys server functions (/admin/keys + the DataPicker of the marketplace
 * registry forms). Thin: permission + validator + ORM context, then the
 * service (../ssh-keys). The private key NEVER crosses back — every DTO is
 * built from public fields only.
 */

/**
 * Paginated key list — the /admin/keys page AND the DataPicker's `fetchPage`
 * (the picker reuses the SAME declaration and query, like every other list).
 * Gated on `panel.keys` read; key NAMES only — the private keys never travel.
 */
export const listSshKeysFn = createServerFn({ method: 'POST' })
  .validator(adminSshKeysList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.keys': ['read'] });

    const { rows, rowCount } = await runListQuery(
      listQueryBuilder(orm.em, SshKey, adminSshKeysList),
      adminSshKeysList.spec,
      data,
    );

    return {
      rowCount,
      rows: rows.map((key): AdminSshKeyRow => {
        const tokens = key.publicKey.split(/\s+/);
        const commentTokens = tokens.slice(2);
        return {
          id: key.id,
          name: key.name,
          type: tokens[0] ?? '',
          fingerprint: key.fingerprint,
          comment: commentTokens.length > 0 ? commentTokens.join(' ') : null,
          publicKey: key.publicKey,
          createdAt: key.createdAt,
        };
      }),
    };
  });

/**
 * Creates a key (generate OR import — the shared flat schema dispatches on
 * `mode`). Returns the public part: the keys page shows the public key once
 * after a generation, to be authorized on the forge.
 */
export const createSshKeyFn = createServerFn({ method: 'POST' })
  .validator(createSshKeySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.keys': ['create'] });

    const created =
      data.mode === 'generate'
        ? await generateSshKey({ name: data.name, comment: data.comment || null })
        : await importSshKey({
            name: data.name,
            privateKey: data.privateKey,
            publicKey: data.publicKey || null,
          });

    return created;
  });

export const deleteSshKeyFn = createServerFn({ method: 'POST' })
  .validator(sshKeyIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.keys': ['delete'] });
    await deleteSshKey(data.sshKeyId);
    return { deleted: true };
  });
