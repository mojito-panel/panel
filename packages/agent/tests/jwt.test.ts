import { describe, it, expect } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { verifyConsoleToken, hasConsolePermission, ConsoleTokenError } from '../src/api/jwt';
import { ALL_PERMISSIONS } from '@mojito/contract';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const SERVER_ID = randomUUID();

/** Local signer (mirrors the panel side) used to forge test tokens. */
function signToken(payload: Record<string, unknown>, secret: string = SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function validPayload(now: number): Record<string, unknown> {
  return {
    iss: 'mojito-panel',
    aud: 'mojito-agent',
    sub: 'user_1',
    serverId: SERVER_ID,
    permissions: [...ALL_PERMISSIONS],
    iat: now,
    exp: now + 300,
    jti: 'tok_test',
  };
}

describe('verifyConsoleToken', () => {
  it('valide un token signé correctement', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = verifyConsoleToken(signToken(validPayload(now)), SECRET, { serverId: SERVER_ID });
    expect(payload.sub).toBe('user_1');
    expect(payload.serverId).toBe(SERVER_ID);
    expect(payload.permissions).toContain('console.write');
  });

  it('rejette un token malformé', () => {
    expect(() => verifyConsoleToken('not-a-jwt', SECRET)).toThrow(ConsoleTokenError);
  });

  it('rejette une signature falsifiée', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(validPayload(now));
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(() => verifyConsoleToken(tampered, SECRET)).toThrow(ConsoleTokenError);
  });

  it('rejette un token signé avec un autre secret', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => verifyConsoleToken(signToken(validPayload(now)), 'wrong-secret'), ).toThrow(ConsoleTokenError);
  });

  it('rejette un algorithme autre que HS256', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(validPayload(now))).toString('base64url');
    expect(() => verifyConsoleToken(`${header}.${body}.`, SECRET)).toThrow(ConsoleTokenError);
  });

  it('rejette un payload non conforme au contract (mauvais aud)', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => verifyConsoleToken(signToken({ ...validPayload(now), aud: 'evil' }), SECRET)).toThrow(
      ConsoleTokenError,
    );
  });

  it('rejette un serverId qui ne correspond pas à la route', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(validPayload(now));
    expect(() => verifyConsoleToken(token, SECRET, { serverId: randomUUID() })).toThrow(ConsoleTokenError);
  });

  it('rejette un token expiré (code expired)', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = { ...validPayload(now), exp: now - 60 };
    try {
      verifyConsoleToken(signToken(expired), SECRET);
      expect.unreachable('doit lever');
    } catch (err) {
      expect(err).toBeInstanceOf(ConsoleTokenError);
      expect((err as ConsoleTokenError).code).toBe('expired');
    }
  });

  it('accepte un token à peine expiré dans la marge d\'horloge (5 s)', () => {
    const now = Math.floor(Date.now() / 1000);
    const barely = { ...validPayload(now), exp: now - 3 };
    expect(() => verifyConsoleToken(signToken(barely), SECRET)).not.toThrow();
  });

  it('rejette un iat dans le futur', () => {
    const now = Math.floor(Date.now() / 1000);
    const future = { ...validPayload(now), iat: now + 60 };
    expect(() => verifyConsoleToken(signToken(future), SECRET)).toThrow(ConsoleTokenError);
  });

  it('rejette une permission inconnue dans le payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = { ...validPayload(now), permissions: ['files.read'] };
    expect(() => verifyConsoleToken(signToken(bad), SECRET)).toThrow(ConsoleTokenError);
  });
});

describe('hasConsolePermission', () => {
  it('accepte une permission présente', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = verifyConsoleToken(signToken(validPayload(now)), SECRET);
    expect(hasConsolePermission(payload, 'console.write')).toBe(true);
  });

  it('refuse une permission absente', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ ...validPayload(now), permissions: ['console.read'] });
    const payload = verifyConsoleToken(token, SECRET);
    expect(hasConsolePermission(payload, 'console.write')).toBe(false);
    expect(hasConsolePermission(payload, 'console.read')).toBe(true);
  });
});
