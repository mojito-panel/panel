import { describe, it, expect } from 'vitest';

import {
  adminServerIdSchema,
  updateAdminServerSchema,
  setAdminServerSuspendedSchema,
  adminServerAllocationActionSchema,
} from '../src/validators/admin-server';

describe('adminServerIdSchema', () => {
  it('accepts an id', () => {
    const result = adminServerIdSchema.safeParse({ serverId: 'srv_123' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = adminServerIdSchema.safeParse({ serverId: '' });
    expect(result.success).toBe(false);
  });
});

describe('updateAdminServerSchema', () => {
  const valid = {
    serverId: 'srv_123',
    name: 'My server',
    ownerId: 'usr_123',
    memoryMb: 2048,
    cpuCores: 1.5,
    backupLimit: 5,
  };

  it('accepts a valid payload (fractional CPU allowed)', () => {
    const result = updateAdminServerSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts unlimited CPU and disabled backups', () => {
    const result = updateAdminServerSchema.safeParse({
      ...valid,
      cpuCores: 0,
      backupLimit: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a too-short name', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, name: 'a' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing owner', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, ownerId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative memory', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, memoryMb: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts unlimited memory (0)', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, memoryMb: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a fractional backup limit', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, backupLimit: 2.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a negative CPU limit', () => {
    const result = updateAdminServerSchema.safeParse({ ...valid, cpuCores: -1 });
    expect(result.success).toBe(false);
  });
});

describe('setAdminServerSuspendedSchema', () => {
  it('accepts a suspend request', () => {
    const result = setAdminServerSuspendedSchema.safeParse({
      serverId: 'srv_123',
      suspended: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    const result = setAdminServerSuspendedSchema.safeParse({
      serverId: 'srv_123',
      suspended: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

describe('adminServerAllocationActionSchema', () => {
  it('accepts a server + allocation pair', () => {
    const result = adminServerAllocationActionSchema.safeParse({
      serverId: 'srv_123',
      allocationId: 'alloc_456',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing allocation', () => {
    const result = adminServerAllocationActionSchema.safeParse({
      serverId: 'srv_123',
      allocationId: '',
    });
    expect(result.success).toBe(false);
  });

  it('picks the allocationId field alone (claim form)', () => {
    const claimSchema = adminServerAllocationActionSchema.pick({ allocationId: true });
    const result = claimSchema.safeParse({ allocationId: 'alloc_456' });
    expect(result.success).toBe(true);
  });
});
