import type { ServerAllocationPayload } from '@mojito/contract';
import type { SystemVariables } from '../runner/templating';

/**
 * Construit les variables système de l'agent.
 * Source unique partagée entre l'install (API) et le start (registry).
 */
export function buildSystemVariables(
  serverId: string,
  name: string,
  installDir: string,
  allocation: ServerAllocationPayload,
): SystemVariables {
  return {
    SERVER_UUID: serverId,
    SERVER_NAME: name,
    SERVER_MEMORY: allocation.memoryMb,
    SERVER_PORT: allocation.port,
    SERVER_IP: allocation.ip,
    SERVER_INSTALL_DIR: installDir,
  };
}
