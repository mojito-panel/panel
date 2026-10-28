/**
 * SSH public key helpers — PURE TypeScript (client + server safe, no node
 * imports: the list modules render the type labels client-side).
 *
 * A stored key pair holds the OpenSSH public key line
 * (`<type> <base64 blob> [comment]`) and the private key (OpenSSH or PEM,
 * encrypted at rest). Parsing here validates the STRUCTURE of a public key
 * (declared type + decoded blob wire format) without shelling out; the
 * SHA256 fingerprint is computed by the service (`~/server/ssh-keys`,
 * node:crypto) and the private side is validated by `ssh-keygen` — the same
 * system-binary philosophy as the git clones of ~/server/git-source.
 */

/** Public key types accepted in an authorized_keys-style line. */
const PUBLIC_KEY_TYPES = [
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
] as const;

/** A parsed OpenSSH public key line. */
export interface ParsedPublicKey {
  /** Key type — e.g. "ssh-ed25519". */
  type: string;
  /** The base64 blob (2nd token), as written — the service hashes it. */
  blobBase64: string;
  /** Trailing comment — null when absent. */
  comment: string | null;
}

/**
 * Parses and validates an OpenSSH public key line. Returns null when the
 * line is not a structurally valid public key (wrong shape, unknown type,
 * blob whose embedded type does not match the declared one).
 */
export function parsePublicKey(text: string): ParsedPublicKey | null {
  const line = text.trim().replace(/\r/g, '');
  if (!line || line.includes('\n')) return null;

  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return null;

  const [type, blobBase64, ...commentTokens] = tokens;
  if (!(PUBLIC_KEY_TYPES as readonly string[]).includes(type)) return null;

  // Wire format check: the blob starts with a length-prefixed string that
  // MUST repeat the declared type — a cheap, strong structural validation.
  let blob: Uint8Array;
  try {
    blob = Uint8Array.from(atob(blobBase64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (blob.length < 4) return null;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const declaredLength = view.getUint32(0);
  if (declaredLength > blob.length - 4) return null;
  const declared = new TextDecoder().decode(blob.subarray(4, 4 + declaredLength));
  if (declared !== type) return null;

  const comment = commentTokens.length > 0 ? commentTokens.join(' ') : null;
  return { type, blobBase64, comment };
}

/** French label of a key type — the badge text of the keys list. */
export function publicKeyTypeLabel(type: string): string {
  if (type.startsWith('sk-')) return 'FIDO';
  if (type === 'ssh-ed25519') return 'Ed25519';
  if (type === 'ssh-rsa') return 'RSA';
  if (type.startsWith('ecdsa-')) return 'ECDSA';
  return type;
}

/** Private key PEM/OpenSSH headers accepted on import. */
const PRIVATE_KEY_HEADERS = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
] as const;

/** True when the text LOOKS like an SSH private key (header check only —
 * the real validation runs `ssh-keygen -y` in the service). */
export function looksLikePrivateKey(text: string): boolean {
  const first = text.trim().replace(/\r\n/g, '\n').split('\n')[0] ?? '';
  return (PRIVATE_KEY_HEADERS as readonly string[]).includes(first.trim());
}

/** True for ssh git remotes — canonical ssh:// URLs and the SCP shorthand. */
export function isSshRemote(url: string): boolean {
  return url.startsWith('ssh://') || /^[^@/:]+@[^/:]+:/.test(url);
}
