import { describe, it, expect } from 'vitest';
import { HEALTH_TOKEN_TTL_SECONDS } from '@mojito/contract';
import { signHealthToken } from '../src/server/jwt';
// Direct import of the agent's verifier — cross-package on purpose:
// this pins the sign/verify symmetry between the two sides of the contract.
import { verifyHealthToken } from '../../agent/src/router/tokens/parser';

const SECRET = 'symmetry-secret-0123456789abcdef012345';
const USER_ID = 'admin_sym';

describe('Panel sign ↔ agent verify — health JWT (symmetry)', () => {
  it('un token health signé par le panel est accepté par l’agent', () => {
    const { token, expiresAt } = signHealthToken({ userId: USER_ID }, SECRET);
    const payload = verifyHealthToken(token, SECRET);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.scope).toBe('health');
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('le TTL du health token est court (5 min)', () => {
    // now aligned on a whole second — signHealthToken floors to seconds
    const now = Math.floor(Date.now() / 1000) * 1000;
    const { expiresAt } = signHealthToken({ userId: USER_ID, now }, SECRET);
    expect(expiresAt - now).toBe(HEALTH_TOKEN_TTL_SECONDS * 1000);
  });

  it('l’agent rejette un secret différent', () => {
    const { token } = signHealthToken({ userId: USER_ID }, SECRET);
    expect(() => verifyHealthToken(token, 'other-secret-0123456789abcdef')).toThrow();
  });

  it('l’agent rejette un token health expiré', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { token } = signHealthToken({ userId: USER_ID, now: past * 1000 }, SECRET);
    expect(() => verifyHealthToken(token, SECRET)).toThrow(/expired/);
  });
});
