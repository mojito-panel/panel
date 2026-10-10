import type { ServerAllocationPayload } from '@mojito/contract';
import type { SystemVariables } from './templating';

/**
 * Builds the agent's system variables.
 * Single source shared between install (API) and start (registry).
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
