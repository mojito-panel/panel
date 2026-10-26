import { describe, expect, it } from 'vitest';

import {
  consoleMessageEmoji,
  formatBytes,
  renderConsoleEvent,
  renderConsoleMessage,
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

describe('renderConsoleEvent', () => {
  it('wraps install step events in the "Step X/Y" envelope', () => {
    const out = renderConsoleEvent('install.action.download', {
      step: '3',
      total: '5',
      dest: 'server.jar',
    });
    // Step X/Y — <action> — the emoji itself is content, not structure
    expect(out).toMatch(/^Step 3\/5 — .+$/);
  });

  it('renders non-step events without an envelope', () => {
    const code = 'install.reinstall';
    const params = { name: 'S', steps: '2' };
    expect(renderConsoleEvent(code, params)).toBe(renderConsoleMessage(code, params));
  });

  it('returns null for an unknown code (old agent)', () => {
    expect(renderConsoleEvent('install.unknown')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats bytes with the matching unit', () => {
    expect(formatBytes(512)).toMatch(/ B$/);
    expect(formatBytes(2048)).toMatch(/ KB$/);
    expect(formatBytes(1258291)).toMatch(/ MB$/);
  });
});

describe('watchdog events', () => {
  it('renders the watchdog violation and squat codes with params and an emoji', () => {
    const violation = renderConsoleMessage('watchdog.violation', {
      protocol: 'tcp',
      port: '27015',
      pid: '4242',
    });
    const squat = renderConsoleMessage('watchdog.squat', {
      protocol: 'tcp',
      port: '25565',
      pid: '4242',
      user: 'mojito-abc',
    });
    // Structure only — the text itself is content, the params must flow.
    expect(violation).toContain('27015');
    // The violation warns the server will be killed once the port is
    // requested by another server — that sentence is the whole point.
    expect(violation).toContain('killed');
    expect(squat).toContain('mojito-abc');
    expect(consoleMessageEmoji('watchdog.violation')).not.toBe('');
    expect(consoleMessageEmoji('watchdog.squat')).not.toBe('');
  });

  it('renders the killed event the squatter receives on its own console', () => {
    const killed = renderConsoleMessage('watchdog.killed', {
      protocol: 'tcp',
      port: '25565',
      pid: '20',
      server: 'Survival Server',
    });
    expect(killed).toContain('25565');
    expect(killed).toContain('Survival Server');
    expect(consoleMessageEmoji('watchdog.killed')).not.toBe('');
  });
});
