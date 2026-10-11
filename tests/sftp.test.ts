import { describe, it, expect } from 'vitest';
import { parseSftpUsername, buildSftpUsername } from '~/lib/sftp';
import { toSftpPermissions } from '~/lib/permissions';
import { buildAgentConfig } from '~/lib/agent-config';
import { sftpAuthRequestSchema, sftpAuthResponseSchema, DEFAULT_SFTP_PORT } from '~/contract';

describe('parseSftpUsername', () => {
  it('splits at the LAST dot — emails may contain dots', () => {
    const parsed = parseSftpUsername(
      'jean.dupont@mail.example.com.123e4567-e89b-12d3-a456-426614174000',
    );
    expect(parsed).toEqual({
      email: 'jean.dupont@mail.example.com',
      serverId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('round-trips with buildSftpUsername', () => {
    const username = buildSftpUsername('a.b@c.fr', '123e4567-e89b-12d3-a456-426614174000');
    expect(parseSftpUsername(username)).toEqual({
      email: 'a.b@c.fr',
      serverId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('rejects malformed usernames', () => {
    const invalid = [
      '',                                   // empty
      'user@example.com',                   // no server id
      'user@example.com.not-a-uuid',        // bad server id
      '.123e4567-e89b-12d3-a456-426614174000', // empty email
      'user@example.com.',                  // empty server id
    ];
    for (const username of invalid) {
      expect(parseSftpUsername(username)).toBeNull();
    }
  });
});

describe('toSftpPermissions', () => {
  it('maps every server.files grant onto the wings file.* list', () => {
    expect(
      toSftpPermissions([
        'server.files.read',
        'server.files.write',
        'server.files.create',
        'server.files.delete',
      ]).sort(),
    ).toEqual(['file.create', 'file.delete', 'file.read', 'file.read-content', 'file.update'].sort());
  });

  it('read alone grants read + read-content (download) but no write', () => {
    const permissions = toSftpPermissions(['server.files.read']);
    expect(permissions).toContain('file.read');
    expect(permissions).toContain('file.read-content');
    expect(permissions).not.toContain('file.update');
    expect(permissions).not.toContain('file.create');
  });

  it('ignores non-files permissions and yields an empty list (no SFTP)', () => {
    expect(toSftpPermissions(['server.console.read', 'server.power.start'])).toEqual([]);
  });

  it('is deduplicated regardless of grant order', () => {
    expect(toSftpPermissions(['server.files.read', 'server.files.read'])).toEqual([
      'file.read',
      'file.read-content',
    ]);
  });
});

describe('sftp contract schemas', () => {
  it('sftpAuthRequestSchema accepts the agent payload', () => {
    const parsed = sftpAuthRequestSchema.parse({
      username: 'user@example.com.123e4567-e89b-12d3-a456-426614174000',
      password: 'secret',
      ip: '127.0.0.1:54321',
    });
    expect(parsed.username).toContain('.');
  });

  it('sftpAuthResponseSchema accepts "*" (owner) and the file.* list', () => {
    const owner = sftpAuthResponseSchema.parse({
      user: 'user-1',
      server: '123e4567-e89b-12d3-a456-426614174000',
      permissions: ['*'],
    });
    expect(owner.permissions).toEqual(['*']);
    const subuser = sftpAuthResponseSchema.parse({
      user: 'user-2',
      server: '123e4567-e89b-12d3-a456-426614174000',
      permissions: ['file.read', 'file.read-content'],
    });
    expect(subuser.permissions).toHaveLength(2);
  });

  it('exposes the wings default SFTP port', () => {
    expect(DEFAULT_SFTP_PORT).toBe(2022);
  });
});

describe('buildAgentConfig', () => {
  it('emits the sftp section the agent config pins (TestPanelGeneratedConfigIsLoadable)', () => {
    const yaml = buildAgentConfig({
      name: 'node1',
      fqdn: 'node1.example.com',
      agentPort: 8081,
      sftpPort: 2022,
      agentToken: 'a'.repeat(40),
      panelUrl: 'http://panel.example.com',
    });
    expect(yaml).toContain('sftp:\n  enabled: true\n  host: 0.0.0.0\n  port: 2022\n');
  });
});
