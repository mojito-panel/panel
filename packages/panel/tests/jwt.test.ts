import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  CONSOLE_TOKEN_TTL_SECONDS,
  consoleTokenPayloadSchema,
} from '@mojito/contract';
import { signConsoleToken } from '../src/server/jwt';

const SECRET = 'panel-secret-0123456789abcdef0123456789abcdef';
const USER_ID = 'user_42';
const SERVER_ID = randomUUID();

function decodePayload(token: string): Record<string, unknown> {
  const body = token.split('.')[1];
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

function expectedSignature(token: string): string {
  const [header, body] = token.split('.');
  return createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
}

describe('signConsoleToken', () => {
  it('produces an HS256 token whose signature matches the secret (symmetry with the agent)', () => {
    const { token } = signConsoleToken(
      { userId: USER_ID, serverId: SERVER_ID },
      SECRET,
    );
    const [header, , signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(signature).toBe(expectedSignature(token));
  });

  it('emits a payload conforming to the contract, with all permissions in V1', () => {
    const now = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = signConsoleToken(
      { userId: USER_ID, serverId: SERVER_ID },
      SECRET,
      { now: now * 1000 },
    );
    const payload = decodePayload(token);
    expect(() => consoleTokenPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.sub).toBe(USER_ID);
    expect(payload.serverId).toBe(SERVER_ID);
    expect(payload.iss).toBe('mojito-panel');
    expect(payload.aud).toBe('mojito-agent');
    expect(payload.scope).toBe('websocket');
    expect(payload.permissions).toEqual([...ALL_PERMISSIONS]);
    expect(payload.exp).toBe(now + CONSOLE_TOKEN_TTL_SECONDS);
    expect(expiresAt).toBe((now + CONSOLE_TOKEN_TTL_SECONDS) * 1000);
  });

  it('accepts a narrowed permission list (ready for V2 invitations)', () => {
    const { token } = signConsoleToken(
      { userId: USER_ID, serverId: SERVER_ID, permissions: ['console.read'] },
      SECRET,
    );
    expect(decodePayload(token).permissions).toEqual(['console.read']);
  });

  it('rejects an unknown permission early', () => {
    expect(() =>
      signConsoleToken(
        { userId: USER_ID, serverId: SERVER_ID, permissions: ['admin.*'] },
        SECRET,
      ),
    ).toThrow();
  });
});
