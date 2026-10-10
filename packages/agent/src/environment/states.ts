import type { ServerStatus } from '@mojito/contract';

/**
 * Process runtime states (in the agent, distinct from panel states).
 * Aligned with wings: offline / starting / running / stopping.
 *
 * Go through `stopping` BEFORE `offline` on a stop
 * so crash detection is not triggered.
 */
export type ProcessState = 'offline' | 'starting' | 'running' | 'stopping';

/** Maps the runtime state to the persisted panel status. */
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
