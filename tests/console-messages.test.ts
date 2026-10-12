import { describe, expect, it } from 'vitest';

import {
  consoleMessageEmoji,
  formatBytes,
  renderConsoleMessage,
  renderInstallLine,
} from '../src/components/console/messages';

// The catalog text and the emoji map are CONTENT (edited freely) — these
// tests pin STRUCTURE only, so message/emoji changes never break them.

describe('renderConsoleMessage', () => {
  it('returns null for an unknown code (old agent)', () => {
    expect(renderConsoleMessage('install.unknown')).toBeNull();
  });

  it('renders a non-empty message for a known code', () => {
    expect(renderConsoleMessage('install.start', { name: 'My Server', steps: '5' })).toBeTruthy();
  });

  it('interpolates the params into the message', () => {
    const a = renderConsoleMessage('install.start', { name: 'Alpha', steps: '5' });
    const b = renderConsoleMessage('install.start', { name: 'Beta', steps: '5' });
    expect(a).not.toBe(b);
    expect(a).toContain('Alpha');
    expect(b).toContain('Beta');
  });
});

describe('consoleMessageEmoji', () => {
  it('returns an empty string for codes without an emoji', () => {
    expect(consoleMessageEmoji('install.unknown')).toBe('');
    expect(consoleMessageEmoji('not.a.code')).toBe('');
  });
});

describe('renderInstallLine', () => {
  const ts = new Date().toISOString();

  it('wraps step lines in the "Step X/Y" envelope after the emoji', () => {
    const out = renderInstallLine({
      timestamp: ts,
      level: 'step',
      message: '',
      code: 'install.action.download',
      params: { step: '3', total: '5', dest: 'server.jar' },
    });
    // <emoji> Step X/Y — <action> — the emoji itself is content, not structure
    expect(out).toMatch(/^.+ Step 3\/5 — .+$/);
  });

  it('prefixes coded info lines with their emoji and a space', () => {
    const code = 'install.reinstall';
    const params = { name: 'S', steps: '2' };
    const text = renderConsoleMessage(code, params);
    const emoji = consoleMessageEmoji(code);
    expect(renderInstallLine({ timestamp: ts, level: 'info', message: '', code, params })).toBe(
      emoji ? `${emoji} ${text}` : text,
    );
  });

  it('passes raw command output through', () => {
    expect(renderInstallLine({ timestamp: ts, level: 'info', message: '[Server] Done!' })).toBe(
      '[Server] Done!',
    );
  });

  it('falls back to the raw message for an unknown code', () => {
    expect(
      renderInstallLine({
        timestamp: ts,
        level: 'info',
        message: 'legacy text',
        code: 'install.unknown',
      }),
    ).toBe('legacy text');
  });
});

describe('formatBytes', () => {
  it('formats bytes with the matching unit', () => {
    expect(formatBytes(512)).toMatch(/ B$/);
    expect(formatBytes(2048)).toMatch(/ KB$/);
    expect(formatBytes(1258291)).toMatch(/ MB$/);
  });
});
