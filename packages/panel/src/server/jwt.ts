import { createHmac, randomUUID } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  CONSOLE_TOKEN_TTL_SECONDS,
  consoleTokenPayloadSchema,
  type ConsoleTokenPayload,
  type Permission,
} from '@mojito/contract';

/**
 * Console JWT signing (panel side) — HS256 with node:crypto only.
 * MUST stay symmetric with the agent's `verifyConsoleToken`
 * (packages/agent/src/api/jwt.ts): same header shape.
 * Pelican-style: the signing key is the node's OWN agent token — no separate
 * shared secret. The token never leaves the panel DB in clear (encrypted at
 * rest) and is NEVER logged.
 */

function signPayload(payload: ConsoleTokenPayload, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export interface SignConsoleTokenInput {
  userId: string;
  serverId: string;
  /** V1: defaults to every permission (no invitations). */
  permissions?: readonly Permission[];
  /** Injectable clock for tests. */
  now?: number;
}

/** Signs a console JWT for one user on one server. TTL: CONSOLE_TOKEN_TTL_SECONDS. */
export function signConsoleToken(
  input: SignConsoleTokenInput,
  secret: string,
): { token: string; expiresAt: number } {
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const payload = consoleTokenPayloadSchema.parse({
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: input.userId,
    serverId: input.serverId,
    permissions: input.permissions ?? ALL_PERMISSIONS,
    scope: 'websocket',
    iat,
    exp: iat + CONSOLE_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  });
  return { token: signPayload(payload, secret), expiresAt: payload.exp * 1000 };
}
