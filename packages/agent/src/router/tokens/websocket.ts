import type { ConsoleTokenPayload, Permission } from '@mojito/contract';

/**
 * Console token payload helpers (≈ wings router/tokens/websocket.go).
 * The payload schema itself lives in @mojito/contract.
 */

/** Permission gate — called for EVERY incoming console message, not only at connection. */
export function hasConsolePermission(
  payload: ConsoleTokenPayload,
  permission: Permission,
): boolean {
  return payload.permissions.includes(permission);
}
