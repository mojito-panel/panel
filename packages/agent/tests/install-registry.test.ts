import { describe, it, expect } from 'vitest';
import { InstallRegistry } from '../src/server/installer/registry';

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('InstallRegistry (logs)', () => {
  it('merges consecutive identical lines (steamcmd: "[----] Installing update...")', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'started');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Cleaning up...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');

    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual([
      'started',
      '[----] Installing update...',
      '[----] Cleaning up...',
      '[----] Installing update...',
    ]);
  });

  it('replaces the \r rewrite line in place (steamcmd progress)', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'started');
    registry.log(SERVER_ID, 'info', 'Downloading…');
    registry.log(SERVER_ID, 'info', 'progress 10%', { rewrite: true });
    registry.log(SERVER_ID, 'info', 'progress 55%', { rewrite: true });
    registry.log(SERVER_ID, 'info', 'progress 98%', { rewrite: true });

    const state = registry.get(SERVER_ID)!;
    expect(state.logs.map((l) => l.message)).toEqual(['started', 'Downloading…', 'progress 98%']);
  });

  it('appends an isolated rewrite without overwriting the previous output', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'started');
    registry.log(SERVER_ID, 'info', 'Connecting anonymously to Steam Public...OK');
    // First rewrite after a real line: new line, no replacement
    registry.log(SERVER_ID, 'info', ' Update state (0x61) downloading : progress 12.34', { rewrite: true });
    // A real log afterwards → the next rewrite starts on a new line
    registry.log(SERVER_ID, 'info', 'Success! App \'90\' fully installed.');
    registry.log(SERVER_ID, 'info', 'progress 5.00', { rewrite: true });

    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual([
      'started',
      'Connecting anonymously to Steam Public...OK',
      ' Update state (0x61) downloading : progress 12.34',
      'Success! App \'90\' fully installed.',
      'progress 5.00',
    ]);
  });

  it('resets the in-progress rewrite when a new install starts', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'started');
    registry.log(SERVER_ID, 'info', 'progress 42%', { rewrite: true });
    registry.start(SERVER_ID, 'restarted');
    registry.log(SERVER_ID, 'info', 'progress 1%', { rewrite: true });

    // The new rewrite does not replace the previous install's line
    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual(['restarted', 'progress 1%']);
  });
});
