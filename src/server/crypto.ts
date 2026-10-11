import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * At-rest encryption for the agent token (AES-256-GCM, key derived from
 * BETTER_AUTH_SECRET — same pattern as Laravel's `encrypted` cast for
 * Pelican's daemon_token). The token is now also the console-JWT signing
 * key, so it must not sit in plaintext in the database.
 *
 * Format: `enc:v1:<iv>:<tag>:<ciphertext>` (all base64).
 * Values without the prefix are treated as legacy plaintext (no migration
 * needed — rows are encrypted on next write).
 */

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET manquant ou trop court (32+ caractères requis)');
  }
  return createHash('sha256').update(secret).digest();
}

/** Encrypts a secret for storage. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts a stored secret. Legacy plaintext values (pre-encryption rows)
 * pass through unchanged — callers must never write them back unencrypted.
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Token agent illisible (déchiffrement échoué)');
  }
}
