import { describe, expect, it } from 'vitest';

import { EDITABLE_FILE_EXTENSIONS, extensionOf, isEditableFile } from '~/lib/text-files';

describe('editable file whitelist', () => {
  it('exposes exactly the whitelisted extensions', () => {
    expect([...EDITABLE_FILE_EXTENSIONS].sort()).toEqual([
      'ini',
      'json',
      'properties',
      'txt',
      'xml',
      'yaml',
      'yml',
    ]);
  });

  it('accepts every whitelisted extension (case-insensitive)', () => {
    expect(isEditableFile('server.properties.txt')).toBe(true);
    expect(isEditableFile('config.ini')).toBe(true);
    expect(isEditableFile('server.properties')).toBe(true);
    expect(isEditableFile('docker-compose.yml')).toBe(true);
    expect(isEditableFile('paper-global.yaml')).toBe(true);
    expect(isEditableFile('plugin.xml')).toBe(true);
    expect(isEditableFile('recipes.json')).toBe(true);
    expect(isEditableFile('CONFIG.JSON')).toBe(true);
  });

  it('accepts nested relative paths (directories are not part of the check)', () => {
    expect(isEditableFile('plugins/Essentials/config.yml')).toBe(true);
    expect(isEditableFile('world/level.dat.txt')).toBe(true);
  });

  it('refuses binaries and unknown extensions', () => {
    expect(isEditableFile('server.jar')).toBe(false);
    expect(isEditableFile('world/level.dat')).toBe(false);
    expect(isEditableFile('backup.tar.gz')).toBe(false);
    expect(isEditableFile('save.sav')).toBe(false);
    expect(isEditableFile('logo.png')).toBe(false);
  });

  it('refuses extension-less files and dotfiles (not whitelisted)', () => {
    expect(isEditableFile('Dockerfile')).toBe(false);
    expect(isEditableFile('LICENSE')).toBe(false);
    expect(isEditableFile('.env')).toBe(false);
    expect(isEditableFile('.gitignore')).toBe(false);
  });

  it('extensionOf returns the lowercased extension, or empty for dotfiles', () => {
    expect(extensionOf('a/b/c.TXT')).toBe('txt');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('folder.txt/file.yml')).toBe('yml');
  });
});
