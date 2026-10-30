import { describe, it, expect, beforeEach } from 'vitest';

import { encryptSecret, decryptSecret } from '../src/server/crypto';

const SECRET = 'crypto-secret-0123456789abcdef0123456789';

describe('agent token at-rest encryption', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
  });

  it('roundtrips a token (decrypt(encrypt(x)) === x)', () => {
    const token = 'a'.repeat(64);
    const stored = encryptSecret(token);
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain(token);
    expect(decryptSecret(stored)).toBe(token);
  });

  it('produces a different ciphertext every time (random IV)', () => {
    expect(encryptSecret('token-value')).not.toBe(encryptSecret('token-value'));
  });

  it('passes through legacy plaintext values (no migration needed)', () => {
    expect(decryptSecret('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const stored = encryptSecret('a'.repeat(64));
    const parts = stored.split(':');
    parts[3] = Buffer.from('tampered-data').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('rejects decryption without the key', () => {
    const stored = encryptSecret('a'.repeat(64));
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => decryptSecret(stored)).toThrow();
    process.env.BETTER_AUTH_SECRET = 'another-secret-0123456789abcdef012';
    expect(() => decryptSecret(stored)).toThrow();
    process.env.BETTER_AUTH_SECRET = SECRET;
  });
});
