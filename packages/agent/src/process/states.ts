import type { ServerStatus } from '@mojito/contract';

/**
 * Etats runtime du process (dans l'agent, distincts des etats panel).
 * Aligne sur wings : offline / starting / running / stopping.
 *
 * Passer par `stopping` AVANT `offline` lors d'un arret
 * pour ne pas declencher la crash detection.
 */
export type ProcessState = 'offline' | 'starting' | 'running' | 'stopping';

/** Mappe l'etat runtime vers le statut panel persiste. */
export function toPanelStatus(state: ProcessState, crashed: boolean): ServerStatus {
  switch (state) {
    case 'offline':
      return crashed ? 'crashed' : 'stopped';
    case 'starting':
    case 'running':
    case 'stopping':
      return 'running';
  }
}
