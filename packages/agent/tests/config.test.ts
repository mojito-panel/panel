import { describe, it, expect } from 'vitest';
import { loadConfig, agentConfigSchema } from '../src/config';

describe('agentConfigSchema', () => {
  it('applies default values', () => {
    const result = agentConfigSchema.parse({ token: 'a'.repeat(64) });
    expect(result.port).toBe(8080);
    expect(result.host).toBe('0.0.0.0');
    expect(result.dataDir).toBe('C:\PanelData');
    expect(result.allowedOrigins).toEqual([]);
  });

  it('rejects a too-short token', () => {
    const result = agentConfigSchema.safeParse({ token: 'short' });
    expect(result.success).toBe(false);
  });

  it('converts the port from string to number', () => {
    const result = agentConfigSchema.parse({ token: 'a'.repeat(64), port: '9090' });
    expect(result.port).toBe(9090);
  });
});

describe('loadConfig', () => {
  it('loads from environment variables', () => {
    const config = loadConfig({
      AGENT_PORT: '9000',
      AGENT_HOST: '127.0.0.1',
      AGENT_TOKEN: 'c'.repeat(64),
      PANEL_URL: 'https://panel.example.com',
      AGENT_ALLOWED_ORIGINS: ' https://panel.example.com , https://other.example.com ',
      AGENT_DATA_DIR: '/data',
    });
    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.token).toBe('c'.repeat(64));
    expect(config.panelUrl).toBe('https://panel.example.com');
    expect(config.allowedOrigins).toEqual([
      'https://panel.example.com',
      'https://other.example.com',
    ]);
    expect(config.dataDir).toBe('/data');
  });

  it('throws when AGENT_TOKEN is missing', () => {
    expect(() => loadConfig({})).toThrow();
  });
});
