import { describe, it, expect } from 'vitest';

import {
  createBackupSchema,
  createBackupFormSchema,
  restoreBackupSchema,
  deleteBackupSchema,
  backupDownloadSchema,
} from '~/validators/server';

/** Backup wire schemas (server functions) + the create-form schema. */

describe('backup validators', () => {
  it('accepts a create request without a name (default label)', () => {
    const result = createBackupSchema.safeParse({ serverId: 'server-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBeUndefined();
  });

  it('trims the name of a create request', () => {
    const result = createBackupSchema.parse({ serverId: 'server-1', name: '  pre-update  ' });
    expect(result.name).toBe('pre-update');
  });

  it('rejects a create name longer than 128 characters', () => {
    const result = createBackupSchema.safeParse({ serverId: 'server-1', name: 'x'.repeat(129) });
    expect(result.success).toBe(false);
  });

  it('requires the truncate flag on a restore request', () => {
    expect(restoreBackupSchema.safeParse({ serverId: 's', backupId: 'b' }).success).toBe(false);
    expect(
      restoreBackupSchema.safeParse({ serverId: 's', backupId: 'b', truncate: true }).success,
    ).toBe(true);
  });

  it('requires both ids on delete and download requests', () => {
    expect(deleteBackupSchema.safeParse({ serverId: 's' }).success).toBe(false);
    expect(backupDownloadSchema.safeParse({ backupId: 'b' }).success).toBe(false);
  });

  it('rejects a form name longer than 128 characters', () => {
    expect(createBackupFormSchema.safeParse({ name: 'x'.repeat(129) }).success).toBe(false);
    expect(createBackupFormSchema.safeParse({ name: 'pre-update' }).success).toBe(true);
  });
});
