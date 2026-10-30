import '@tanstack/react-start/server-only';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { SshKey, Registry } from '~/db/entities';
import type { ISshKey } from '~/db/types';
import { looksLikePrivateKey, parsePublicKey } from '~/lib/ssh-key';

import { encryptSecret } from './crypto';
import { orm } from './orm';
import { HttpError } from './session';

/**
 * SSH key pair service (server-only) — /admin/keys: key pairs are GENERATED
 * by the system `ssh-keygen` (Ed25519, no passphrase) or IMPORTED, then
 * attached to private recipe registries (marketplace) so their clones
 * authenticate with them — the forge-side equivalent of a deploy key.
 *
 * The private key is encrypted at rest (encryptSecret, same AES-GCM scheme
 * as the agent tokens) and NEVER returned to a client: only the public key
 * and its fingerprint travel back. Private-key validation runs `ssh-keygen`
 * (derive the public key with -y and cross-check it) — the same
 * system-binary philosophy as the git clones of ./git-source.
 */

const execFileAsync = promisify(execFile);

/** Upper bound of one ssh-keygen call — generation is fast, imports too. */
const SSH_KEYGEN_TIMEOUT_MS = 15_000;

/** Runs `ssh-keygen <args>` — ENOENT and failures become readable errors. */
async function sshKeygen(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ssh-keygen', args, {
      timeout: SSH_KEYGEN_TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const failure = err as { code?: string; stderr?: string; message?: string };
    if (failure.code === 'ENOENT') {
      throw new HttpError(
        503,
        'ssh-keygen n’est pas disponible sur le panel — installe OpenSSH ' +
          '(inclus avec Git pour Windows, déjà requis pour les registres)',
      );
    }
    const stderr = failure.stderr?.trim();
    throw new HttpError(
      422,
      stderr ? `ssh-keygen : ${stderr}` : (failure.message ?? 'ssh-keygen a échoué'),
    );
  }
}

/** SHA256 fingerprint of a public key line (OpenSSH display form), or null. */
function fingerprintOf(publicKey: string): string | null {
  const parsed = parsePublicKey(publicKey);
  if (!parsed) return null;
  const blob = Buffer.from(parsed.blobBase64, 'base64');
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** Loads every stored key (small table — the keys page renders it whole). */
export async function listSshKeys(): Promise<ISshKey[]> {
  return orm.em.find(SshKey, {});
}

/** Loads one key (404 when unknown). */
export async function requireSshKey(sshKeyId: string): Promise<ISshKey> {
  const key = await orm.em.findOne(SshKey, { id: sshKeyId });
  if (!key) throw new HttpError(404, 'Clé SSH introuvable');
  return key;
}

/** The wire shape returned by the create functions (public part only). */
export interface CreatedSshKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
}

/**
 * Persists a validated pair. `privateKey`/`publicKey` arrive normalized
 * (callers normalize); the private side is encrypted here, last.
 */
async function persistSshKey(input: {
  name: string;
  privateKey: string;
  publicKey: string;
}): Promise<CreatedSshKey> {
  const em = orm.em;

  const clash = await em.findOne(SshKey, { name: input.name });
  if (clash)
    throw new HttpError(409, `Le nom « ${input.name} » est déjà utilisé par une autre clé`);

  const fingerprint = fingerprintOf(input.publicKey);
  if (!fingerprint) throw new HttpError(422, 'Clé publique invalide');

  const now = new Date();
  const key = em.create(SshKey, {
    name: input.name,
    publicKey: input.publicKey,
    // Encrypted at rest — never selectable in full by a client read.
    privateKey: encryptSecret(input.privateKey),
    fingerprint,
    createdAt: now,
    updatedAt: now,
  });
  em.persist(key);
  await em.flush();

  return { id: key.id, name: key.name, publicKey: key.publicKey, fingerprint };
}

/**
 * Generates a new Ed25519 pair with the system `ssh-keygen` (no passphrase —
 * the panel uses it unattended for its clones). The private key never
 * leaves the server; the caller displays the public key once, to be
 * authorized on the forge (GitHub deploy key, authorized_keys…).
 */
export async function generateSshKey(input: {
  name: string;
  comment?: string | null;
}): Promise<CreatedSshKey> {
  const dir = await mkdtemp(join(tmpdir(), 'mojito-ssh-key-'));
  try {
    const file = join(dir, 'key');
    const comment = input.comment?.trim() || 'mojito-panel';
    await sshKeygen(['-t', 'ed25519', '-N', '', '-C', comment, '-f', file, '-q']);

    const privateKey = await readFile(file, 'utf8');
    const publicKey = (await readFile(`${file}.pub`, 'utf8')).trim();
    return await persistSshKey({ name: input.name, privateKey, publicKey });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Imports an existing private key (OpenSSH or PEM). The public key is
 * ALWAYS derived from the private key via `ssh-keygen -y` — the source of
 * truth — and cross-checked against a user-provided one when given, so a
 * stored pair can never be internally inconsistent.
 */
export async function importSshKey(input: {
  name: string;
  privateKey: string;
  publicKey?: string | null;
}): Promise<CreatedSshKey> {
  const material = input.privateKey.replace(/\r\n/g, '\n').trim();
  if (!looksLikePrivateKey(material)) {
    throw new HttpError(
      422,
      'Clé privée invalide — format OpenSSH ou PEM requis (-----BEGIN … PRIVATE KEY-----)',
    );
  }

  // Write to an ephemeral 0600 file — ssh-keygen refuses stdin keys.
  const dir = await mkdtemp(join(tmpdir(), 'mojito-ssh-key-'));
  let derived: string;
  try {
    const file = join(dir, 'key');
    await writeFile(file, material.endsWith('\n') ? material : `${material}\n`, { mode: 0o600 });
    await chmod(file, 0o600).catch(() => {});
    try {
      derived = (await sshKeygen(['-y', '-f', file])).trim();
    } catch (err) {
      // A readable, actionable message — a perms failure of ssh-keygen on
      // Windows reads the same as a bad key from the admin's point of view.
      throw new HttpError(
        422,
        `Clé privée illisible par ssh-keygen — vérifie le format, ou fournis la clé publique manuellement (${
          (err as Error).message
        })`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  if (input.publicKey?.trim()) {
    const provided = parsePublicKey(input.publicKey);
    const derivedKey = parsePublicKey(derived);
    if (
      !provided ||
      !derivedKey ||
      provided.type !== derivedKey.type ||
      provided.blobBase64 !== derivedKey.blobBase64
    ) {
      throw new HttpError(422, 'La clé publique fournie ne correspond pas à la clé privée');
    }
  }

  return await persistSshKey({ name: input.name, privateKey: material, publicKey: derived });
}

/**
 * Deletes a key — refused while a registry still uses it, so a private
 * repository can never silently lose its credential.
 */
export async function deleteSshKey(sshKeyId: string): Promise<void> {
  const em = orm.em;
  const key = await requireSshKey(sshKeyId);

  const registries = await em.find(Registry, { sshKeyId: key.id });
  if (registries.length > 0) {
    const names = registries.map((registry) => `« ${registry.name} »`).join(', ');
    throw new HttpError(
      409,
      `Clé utilisée par ${registries.length} registre(s) — détache-la d'abord : ${names}`,
    );
  }

  em.remove(key);
  await em.flush();
}
