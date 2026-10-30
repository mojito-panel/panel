import { describe, expect, it } from 'vitest';

import { createNodeSchema, updateNodeSchema } from '../src/validators/node';

/**
 * Node validator tests — the FQDN field feeds `scheme://<fqdn>:<port>`
 * URL interpolation on the server (agent client, console/health WS URLs),
 * so it must stay a bare hostname or IP literal.
 */
describe('node fqdn field', () => {
  const base = {
    name: 'Windows-01',
    agentPort: 8080,
    publicPort: 443,
    scheme: 'https' as const,
    sftpPort: 2022,
  };

  it('accepts bare hostnames and IPv4 literals', () => {
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1.example.com' }).success).toBe(true);
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1' }).success).toBe(true);
    expect(createNodeSchema.safeParse({ ...base, fqdn: '192.168.1.10' }).success).toBe(true);
  });

  it('accepts a BRACKETED IPv6 literal (the only form that survives URL interpolation)', () => {
    expect(createNodeSchema.safeParse({ ...base, fqdn: '[::1]' }).success).toBe(true);
  });

  it('rejects schemes, ports, paths and other URL fragments', () => {
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'https://node1.example.com' }).success).toBe(
      false,
    );
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1.example.com:8443' }).success).toBe(
      false,
    );
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1.example.com/path' }).success).toBe(
      false,
    );
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1.example.com?x=1' }).success).toBe(
      false,
    );
    expect(createNodeSchema.safeParse({ ...base, fqdn: 'node1 example.com' }).success).toBe(false);
  });

  it('applies the same constraint on the edit form', () => {
    expect(
      updateNodeSchema.safeParse({ nodeId: 'node-1', ...base, fqdn: 'node1.example.com' }).success,
    ).toBe(true);
    expect(
      updateNodeSchema.safeParse({ nodeId: 'node-1', ...base, fqdn: 'https://node1.example.com' })
        .success,
    ).toBe(false);
  });
});
