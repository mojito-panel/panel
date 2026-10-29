import { describe, it, expect } from 'vitest';

import {
  parseRegistryManifest,
  manifestCoverPath,
  registryManifestSchema,
} from '~/lib/registry-manifest';

describe('parseRegistryManifest', () => {
  it('parses a full manifest', () => {
    const manifest = parseRegistryManifest(JSON.stringify({
      description: 'Official recipes of Mojito Panel',
      author: 'Mojito Panel',
      license: 'MIT',
      cover: 'artwork/registry.png',
    }));
    expect(manifest.description).toBe('Official recipes of Mojito Panel');
    expect(manifest.author).toBe('Mojito Panel');
    expect(manifest.license).toBe('MIT');
    expect(manifest.cover).toBe('artwork/registry.png');
  });

  it('accepts a minimal manifest — only the description is required', () => {
    const manifest = parseRegistryManifest(JSON.stringify({ description: 'A small registry' }));
    expect(manifest.description).toBe('A small registry');
    expect(manifest.author).toBeUndefined();
    expect(manifest.license).toBeUndefined();
    expect(manifest.cover).toBeUndefined();
  });

  it('rejects invalid JSON with a readable error', () => {
    expect(() => parseRegistryManifest('{not json')).toThrow('not valid JSON');
  });

  it('rejects a manifest without a description', () => {
    expect(() => parseRegistryManifest(JSON.stringify({ author: 'someone' }))).toThrow(
      'description',
    );
    expect(() => parseRegistryManifest(JSON.stringify({ description: '' }))).toThrow('description');
  });

  it('rejects a cover path with an unsupported extension', () => {
    expect(() =>
      parseRegistryManifest(JSON.stringify({ description: 'x', cover: 'art/banner.gif' })),
    ).toThrow('cover');
  });

  it('rejects cover paths that escape the repository', () => {
    const escaping = [
      '../secret.png',
      'art/../../secret.png',
      '/etc/passwd.png',
      'C:\\temp\\cover.png',
    ];
    for (const cover of escaping) {
      const result = registryManifestSchema.safeParse({ description: 'x', cover });
      expect(result.success, `cover "${cover}" must be rejected`).toBe(false);
    }
  });
});

describe('manifestCoverPath (the clone-time peek)', () => {
  it('returns the declared cover path', () => {
    expect(manifestCoverPath('{"cover":"assets/banner.webp"}')).toBe('assets/banner.webp');
  });

  it('reads nothing from an absent, non-string or unparsable cover', () => {
    expect(manifestCoverPath(null)).toBeNull();
    expect(manifestCoverPath('{}')).toBeNull();
    expect(manifestCoverPath('{"cover":42}')).toBeNull();
    expect(manifestCoverPath('{"cover":""}')).toBeNull();
    expect(manifestCoverPath('not json at all')).toBeNull();
  });
});
