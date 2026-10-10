import { describe, it, expect } from 'vitest';
import { InstallRegistry } from '../src/server/installer/registry';

const SERVER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('InstallRegistry (logs)', () => {
  it('fusionne les lignes identiques consécutives (steamcmd: "[----] Installing update...")', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'démarrée');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');
    registry.log(SERVER_ID, 'info', '[----] Cleaning up...');
    registry.log(SERVER_ID, 'info', '[----] Installing update...');

    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual([
      'démarrée',
      '[----] Installing update...',
      '[----] Cleaning up...',
      '[----] Installing update...',
    ]);
  });

  it('remplace la ligne de rewrite \\r en place (progress steamcmd)', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'démarrée');
    registry.log(SERVER_ID, 'info', 'Downloading…');
    registry.log(SERVER_ID, 'info', 'progress 10%', { rewrite: true });
    registry.log(SERVER_ID, 'info', 'progress 55%', { rewrite: true });
    registry.log(SERVER_ID, 'info', 'progress 98%', { rewrite: true });

    const state = registry.get(SERVER_ID)!;
    expect(state.logs.map((l) => l.message)).toEqual(['démarrée', 'Downloading…', 'progress 98%']);
  });

  it('append un rewrite isolé sans écraser la sortie précédente', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'démarrée');
    registry.log(SERVER_ID, 'info', 'Connecting anonymously to Steam Public...OK');
    // Premier rewrite après une vraie ligne : nouvelle ligne, pas de remplacement
    registry.log(SERVER_ID, 'info', ' Update state (0x61) downloading : progress 12.34', { rewrite: true });
    // Un vrai log ensuite → le rewrite suivant repart d’une nouvelle ligne
    registry.log(SERVER_ID, 'info', 'Success! App \'90\' fully installed.');
    registry.log(SERVER_ID, 'info', 'progress 5.00', { rewrite: true });

    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual([
      'démarrée',
      'Connecting anonymously to Steam Public...OK',
      ' Update state (0x61) downloading : progress 12.34',
      'Success! App \'90\' fully installed.',
      'progress 5.00',
    ]);
  });

  it('reset le rewrite en cours au démarrage d’une nouvelle installation', () => {
    const registry = new InstallRegistry();
    registry.start(SERVER_ID, 'démarrée');
    registry.log(SERVER_ID, 'info', 'progress 42%', { rewrite: true });
    registry.start(SERVER_ID, 'relance');
    registry.log(SERVER_ID, 'info', 'progress 1%', { rewrite: true });

    // Le nouveau rewrite ne remplace pas la ligne de l’installation précédente
    const messages = registry.get(SERVER_ID)!.logs.map((l) => l.message);
    expect(messages).toEqual(['relance', 'progress 1%']);
  });
});
