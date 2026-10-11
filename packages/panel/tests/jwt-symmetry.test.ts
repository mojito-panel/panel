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
  it('a token signed by the panel is accepted by the agent', () => {
    const { token } = signConsoleToken({ userId: USER_ID, serverId: SERVER_ID }, SECRET);
    const payload = verifyConsoleToken(token, SECRET, { serverId: SERVER_ID });
    expect(payload.sub).toBe(USER_ID);
    expect(payload.serverId).toBe(SERVER_ID);
    expect(hasConsolePermission(payload, 'console.write')).toBe(true);
  });

  it('the agent rejects a different secret (desynchronized secret rotation)', () => {
    const { token } = signConsoleToken({ userId: USER_ID, serverId: SERVER_ID }, SECRET);
    expect(() => verifyConsoleToken(token, 'other-secret-0123456789abcdef', { serverId: SERVER_ID })).toThrow();
  });

  it('the agent rejects a token expired issued by the panel (short TTL)', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { token } = signConsoleToken(
      { userId: USER_ID, serverId: SERVER_ID, now: past * 1000 },
      SECRET,
    );
    expect(() => verifyConsoleToken(token, SECRET, { serverId: SERVER_ID })).toThrow(/expired/);
  });
});
