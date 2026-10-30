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

/** Shipped placeholder secrets — never valid anywhere (.env.default and its obvious variants). */
const PLACEHOLDER_SECRETS = new Set(['change-me-generate-a-32-bytes-secret']);

/**
 * True when BETTER_AUTH_SECRET is missing, too short, or a known shipped
 * placeholder — i.e. the at-rest encryption key AND the better-auth
 * signing secret would be publicly predictable. Checked at boot
 * (src/server.ts): a production panel refuses to start, a dev setup
 * gets a loud warning.
 */
export function isSecretInsecure(secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return true;
  if (PLACEHOLDER_SECRETS.has(secret)) return true;
  return /^change[-_ ]?me/i.test(secret);
}

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
  // authTagLength is EXPLICIT: Node 24 marks implicit GCM auth-tag sizes as
  // deprecated (DEP0182) — a future release will refuse the call without it.
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv, { authTagLength: 16 });
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
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivB64, 'base64'),
      {
        authTagLength: 16,
      },
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Token agent illisible (déchiffrement échoué)');
  }
}
