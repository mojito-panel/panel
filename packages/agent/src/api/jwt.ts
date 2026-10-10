import { createHmac, timingSafeEqual } from 'node:crypto';
import { consoleTokenPayloadSchema, type ConsoleTokenPayload, type Permission } from '@mojito/contract';

/**
 * Console JWT verification — HS256 with node:crypto only, no jwt library.
 * The panel signs the token (same shared secret), the agent verifies it.
 */

export type ConsoleTokenErrorCode = 'invalid' | 'expired';

/** Verification failure — `code` maps to a 401-class WS close, never leaked to the client. */
export class ConsoleTokenError extends Error {
  readonly code: ConsoleTokenErrorCode;

  constructor(code: ConsoleTokenErrorCode, message: string) {
    super(message);
    this.name = 'ConsoleTokenError';
    this.code = code;
  }
}

/** Accepted clock skew (seconds) when checking `exp` and `iat`. */
export const CLOCK_SKEW_SECONDS = 5;

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Constant-time comparison of two buffers. */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface VerifyConsoleTokenOptions {
  /** If set, the token `serverId` must match (route parameter check). */
  serverId?: string;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Verifies a console JWT: HS256 signature, then Zod payload validation
 * (iss/aud/serverId/permissions shapes), then `exp` with a 5 s clock skew.
 * Throws ConsoleTokenError('invalid' | 'expired').
 */
export function verifyConsoleToken(
  token: string,
  secret: string,
  options: VerifyConsoleTokenOptions = {},
): ConsoleTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ConsoleTokenError('invalid', 'Malformed JWT');
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString('utf8'));
  } catch {
    throw new ConsoleTokenError('invalid', 'Malformed JWT header');
  }
  if (header.alg !== 'HS256') {
    throw new ConsoleTokenError('invalid', 'Unsupported JWT algorithm');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  if (!safeEqual(base64UrlDecode(signaturePart), Buffer.from(expectedSignature, 'base64'))) {
    throw new ConsoleTokenError('invalid', 'Bad JWT signature');
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new ConsoleTokenError('invalid', 'Malformed JWT payload');
  }

  const parsed = consoleTokenPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new ConsoleTokenError('invalid', 'JWT payload rejected');
  }
  const payload = parsed.data;

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new ConsoleTokenError('expired', 'JWT expired');
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new ConsoleTokenError('invalid', 'JWT issued in the future');
  }

  if (options.serverId !== undefined && payload.serverId !== options.serverId) {
    throw new ConsoleTokenError('invalid', 'JWT serverId mismatch');
  }

  return payload;
}

/** Permission gate — called for EVERY incoming console message, not only at connection. */
export function hasConsolePermission(
  payload: ConsoleTokenPayload,
  permission: Permission,
): boolean {
  return payload.permissions.includes(permission);
}
