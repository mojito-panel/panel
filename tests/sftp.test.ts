import { describe, it, expect } from 'vitest';

import { sftpAuthRequestSchema, sftpAuthResponseSchema } from '~/contract';
import { buildAgentConfig } from '~/lib/agent-config';
import { toSftpPermissions } from '~/lib/permissions';
import { parseSftpUsername, buildSftpUsername } from '~/lib/sftp';

describe('parseSftpUsername', () => {
  it('splits at the LAST dot — the username part never contains dots', () => {
    const parsed = parseSftpUsername('jdoe.123e4567-e89b-12d3-a456-426614174000');
    expect(parsed).toEqual({
      username: 'jdoe',
      serverId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('accepts a nanoid serverId (panel-generated since the nanoid migration)', () => {
    const parsed = parseSftpUsername('jdoe.V1StGXR8_Z5jdHi6B-myT');
    expect(parsed).toEqual({
      username: 'jdoe',
      serverId: 'V1StGXR8_Z5jdHi6B-myT',
    });
  });

  it('accepts any non-empty serverId (the DB lookup is the real validation)', () => {
    const parsed = parseSftpUsername('jdoe.some-random-id');
    expect(parsed).toEqual({ username: 'jdoe', serverId: 'some-random-id' });
  });

  it('round-trips with buildSftpUsername', () => {
    const username = buildSftpUsername('jdoe', 'V1StGXR8_Z5jdHi6B-myT');
    expect(parseSftpUsername(username)).toEqual({
      username: 'jdoe',
      serverId: 'V1StGXR8_Z5jdHi6B-myT',
    });
  });

  it('rejects malformed usernames', () => {
    const invalid = [
      '', // empty
      'jdoe', // no server id
      'jdoe@x.123e4567-e89b-12d3-a456-426614174000', // @ in the username
      '.123e4567-e89b-12d3-a456-426614174000', // empty username
      'jdoe.', // empty server id
      'jean.dupont.123e4567-e89b-12d3-a456-426614174000', // dots in the username
      'ab.123e4567-e89b-12d3-a456-426614174000', // username too short
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
    ).toEqual(
      ['file.create', 'file.delete', 'file.read', 'file.read-content', 'file.update'].sort(),
    );
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
      username: 'jdoe.V1StGXR8_Z5jdHi6B-myT',
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

  it('emits the dedicated users section (native process model)', () => {
    const yaml = buildAgentConfig({
      name: 'node1',
      fqdn: 'node1.example.com',
      agentPort: 8081,
      sftpPort: 2022,
      agentToken: 'a'.repeat(40),
      panelUrl: 'http://panel.example.com',
    });
    expect(yaml).toContain('users:\n  prefix: mojito-\n  group: MojitoServers\n');
  });
});
