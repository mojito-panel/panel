import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signConsoleToken } from '../src/server/jwt';
// Direct import of the agent's verifier — cross-package on purpose:
// this pins the sign/verify symmetry between the two sides of the contract.
import { verifyConsoleToken } from '../../agent/src/router/tokens/parser';
import { hasConsolePermission } from '../../agent/src/router/tokens/websocket';

const SECRET = 'symmetry-secret-0123456789abcdef012345';
const USER_ID = 'user_sym';
const SERVER_ID = randomUUID();

describe('Panel sign ↔ agent verify (symmetry)', () => {
  it('un token signé par le panel est accepté par l’agent', () => {
    const { token } = signConsoleToken({ userId: USER_ID, serverId: SERVER_ID }, SECRET);
    const payload = verifyConsoleToken(token, SECRET, { serverId: SERVER_ID });
    expect(payload.sub).toBe(USER_ID);
    expect(payload.serverId).toBe(SERVER_ID);
    expect(hasConsolePermission(payload, 'console.write')).toBe(true);
  });

  it('l’agent rejette un secret différent (rotation de secret désynchronisée)', () => {
    const { token } = signConsoleToken({ userId: USER_ID, serverId: SERVER_ID }, SECRET);
    expect(() => verifyConsoleToken(token, 'other-secret-0123456789abcdef', { serverId: SERVER_ID })).toThrow();
  });

  it('l’agent rejette un token expiré émis par le panel (TTL court)', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { token } = signConsoleToken(
      { userId: USER_ID, serverId: SERVER_ID, now: past * 1000 },
      SECRET,
    );
    expect(() => verifyConsoleToken(token, SECRET, { serverId: SERVER_ID })).toThrow(/expired/);
  });
});
