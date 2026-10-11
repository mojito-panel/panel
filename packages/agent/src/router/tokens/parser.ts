import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ZodType } from 'zod';
import {
  backupDownloadTokenPayloadSchema,
  consoleTokenPayloadSchema,
  healthTokenPayloadSchema,
  type BackupDownloadTokenPayload,
  type ConsoleTokenPayload,
  type HealthTokenPayload,
} from '@mojito/contract';

/**
 * JWT verification (≈ wings router/tokens/parser.go) — HS256 with
 * node:crypto only, no jwt library. The panel signs the token with the
 * node's agent token, the agent verifies it with its own token (single
 * per-node secret, like Pelican). Two token families share the core:
 * - console tokens (scope `websocket`) — console/power actions;
 * - health tokens (scope `health`) — read-only node stats stream.
 */

export type TokenErrorCode = 'invalid' | 'expired';

/** Verification failure — `code` maps to a 401-class WS close, never leaked to the client. */
export class TokenError extends Error {
  readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

/** Backwards-compatible aliases (the console flow was the first token family). */
export { TokenError as ConsoleTokenError };
export type { TokenErrorCode as ConsoleTokenErrorCode };

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

export interface VerifyTokenOptions {
  /** If set, the token `serverId` must match (route parameter check). */
  serverId?: string;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Verifies an agent JWT: HS256 signature, then Zod payload validation
 * (iss/aud/shape), then `exp` with a 5 s clock skew.
 * Throws TokenError('invalid' | 'expired').
 */
function verifySignedToken<Payload>(
  token: string,
  secret: string,
  schema: ZodType<Payload>,
  options: VerifyTokenOptions = {},
): Payload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenError('invalid', 'Malformed JWT');
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString('utf8'));
  } catch {
    throw new TokenError('invalid', 'Malformed JWT header');
  }
  if (header.alg !== 'HS256') {
    throw new TokenError('invalid', 'Unsupported JWT algorithm');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  if (!safeEqual(base64UrlDecode(signaturePart), Buffer.from(expectedSignature, 'base64'))) {
    throw new TokenError('invalid', 'Bad JWT signature');
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new TokenError('invalid', 'Malformed JWT payload');
  }

  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new TokenError('invalid', 'JWT payload rejected');
  }
  const payload = parsed.data as Payload & { exp: number; iat: number; serverId?: string };

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new TokenError('expired', 'JWT expired');
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new TokenError('invalid', 'JWT issued in the future');
  }

  if (options.serverId !== undefined && payload.serverId !== options.serverId) {
    throw new TokenError('invalid', 'JWT serverId mismatch');
  }

  return payload;
}

/** Console JWT (scope `websocket`) — `serverId` must match the WS route. */
export function verifyConsoleToken(
  token: string,
  secret: string,
  options: VerifyTokenOptions = {},
): ConsoleTokenPayload {
  return verifySignedToken(token, secret, consoleTokenPayloadSchema, options);
}

/** Health JWT (scope `health`) — read-only stats stream, no serverId to bind. */
export function verifyHealthToken(
  token: string,
  secret: string,
  options: VerifyTokenOptions = {},
): HealthTokenPayload {
  return verifySignedToken(token, secret, healthTokenPayloadSchema, options);
}

/** Backup download JWT (scope `backup-download`) — `serverId` must match. */
export function verifyBackupDownloadToken(
  token: string,
  secret: string,
  options: VerifyTokenOptions = {},
): BackupDownloadTokenPayload {
  return verifySignedToken(token, secret, backupDownloadTokenPayloadSchema, options);
}
