import { describe, it, expect } from 'vitest';
import { loadConfig, agentConfigSchema } from '../src/config';

describe('agentConfigSchema', () => {
  it('applique les valeurs par défaut', () => {
    const result = agentConfigSchema.parse({ token: 'a'.repeat(64) });
    expect(result.port).toBe(8080);
    expect(result.host).toBe('0.0.0.0');
    expect(result.dataDir).toBe('C:\PanelData');
  });

  it('rejette un token trop court', () => {
    const result = agentConfigSchema.safeParse({ token: 'short' });
    expect(result.success).toBe(false);
  });

  it('convertit le port string en number', () => {
    const result = agentConfigSchema.parse({ token: 'a'.repeat(64), port: '9090' });
    expect(result.port).toBe(9090);
  });
});

describe('loadConfig', () => {
  it('charge depuis les variables d\'environnement', () => {
    const config = loadConfig({
      AGENT_PORT: '9000',
      AGENT_HOST: '127.0.0.1',
      AGENT_TOKEN: 'c'.repeat(64),
      PANEL_URL: 'https://panel.example.com',
      AGENT_DATA_DIR: '/data',
    });
    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.token).toBe('c'.repeat(64));
    expect(config.panelUrl).toBe('https://panel.example.com');
    expect(config.dataDir).toBe('/data');
  });

  it('lance si AGENT_TOKEN est manquant', () => {
    expect(() => loadConfig({})).toThrow();
  });
});
