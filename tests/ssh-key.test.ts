import { describe, it, expect } from 'vitest';
import {
  parsePublicKey,
  publicKeyTypeLabel,
  looksLikePrivateKey,
  isSshRemote,
} from '../src/lib/ssh-key';

/** Real ed25519 public key (fixture — the matching private key was discarded). */
const ED25519_PUB =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPb6e7BrXlDDwMTLic0r0wR36Ka1OrAsTh0BsUmvEsD2 mojito-probe';

describe('parsePublicKey', () => {
  it('parses an ed25519 public key line (type, blob, comment)', () => {
    expect(parsePublicKey(ED25519_PUB)).toEqual({
      type: 'ssh-ed25519',
      blobBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIPb6e7BrXlDDwMTLic0r0wR36Ka1OrAsTh0BsUmvEsD2',
      comment: 'mojito-probe',
    });
  });

  it('accepts a key line without a comment', () => {
    const parsed = parsePublicKey(ED25519_PUB.replace(/ mojito-probe$/, ''));
    expect(parsed).not.toBeNull();
    expect(parsed?.comment).toBeNull();
  });

  it('trims surrounding whitespace and CRLF carriage returns', () => {
    const parsed = parsePublicKey(`  ${ED25519_PUB.replace('mojito-probe', 'user@host')}\r`);
    expect(parsed?.comment).toBe('user@host');
  });

  it('parses an RSA public key line', () => {
    // Real 2048-bit RSA public key, truncated blob is fine for the parser
    // (the declared-type check reads the first field only).
    const rsa =
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDLxA9JhNjK9PAvHZGl8KLvJMDCDE1f user@host';
    expect(parsePublicKey(rsa)?.type).toBe('ssh-rsa');
    expect(parsePublicKey(rsa)?.comment).toBe('user@host');
  });

  it('rejects garbage, PEM bodies, empty and multi-line input', () => {
    expect(parsePublicKey('hello world')).toBeNull();
    expect(parsePublicKey('')).toBeNull();
    expect(parsePublicKey('-----BEGIN OPENSSH PRIVATE KEY-----')).toBeNull();
    expect(parsePublicKey(`${ED25519_PUB}\nssh-rsa AAAAB3NzaC1yc2E x`)).toBeNull();
  });

  it('rejects a blob whose embedded type contradicts the declared one', () => {
    // The ed25519 blob of the fixture, declared as ssh-rsa.
    expect(parsePublicKey(`ssh-rsa ${ED25519_PUB.split(' ')[1]}`)).toBeNull();
  });

  it('rejects an unknown key type', () => {
    expect(
      parsePublicKey('ssh-dss AAAAC3NzaC1lZDI1NTE5AAAAIPb6e7BrXlDDwMTLic0r0wR36Ka1OrAsTh0BsUmvEsD2'),
    ).toBeNull();
  });

  it('rejects a truncated blob', () => {
    expect(parsePublicKey('ssh-ed25519 AAAA')).toBeNull();
    expect(parsePublicKey('ssh-ed25519 !!!not-base64!!!')).toBeNull();
  });
});

describe('publicKeyTypeLabel', () => {
  it('maps the known types to short labels', () => {
    expect(publicKeyTypeLabel('ssh-ed25519')).toBe('Ed25519');
    expect(publicKeyTypeLabel('ssh-rsa')).toBe('RSA');
    expect(publicKeyTypeLabel('ecdsa-sha2-nistp256')).toBe('ECDSA');
    expect(publicKeyTypeLabel('sk-ssh-ed25519@openssh.com')).toBe('FIDO');
  });

  it('falls back to the raw type', () => {
    expect(publicKeyTypeLabel('unknown-type')).toBe('unknown-type');
  });
});

describe('looksLikePrivateKey', () => {
  it('accepts the OpenSSH and legacy PEM headers', () => {
    expect(looksLikePrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk')).toBe(true);
    expect(looksLikePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nMIIE')).toBe(true);
    expect(looksLikePrivateKey('-----BEGIN EC PRIVATE KEY-----\nMHc')).toBe(true);
    expect(looksLikePrivateKey('-----BEGIN DSA PRIVATE KEY-----\nMIIB')).toBe(true);
  });

  it('accepts CRLF line endings', () => {
    expect(looksLikePrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\r\nb3BlbnNzaC1rZXk')).toBe(true);
  });

  it('rejects a public key line or free text', () => {
    expect(looksLikePrivateKey(ED25519_PUB)).toBe(false);
    expect(looksLikePrivateKey('not a key at all')).toBe(false);
    expect(looksLikePrivateKey('')).toBe(false);
  });
});

describe('isSshRemote', () => {
  it('accepts canonical ssh:// URLs and the SCP shorthand', () => {
    expect(isSshRemote('ssh://git@github.com/owner/repo')).toBe(true);
    expect(isSshRemote('git@github.com:owner/repo.git')).toBe(true);
  });

  it('rejects https URLs', () => {
    expect(isSshRemote('https://github.com/owner/repo')).toBe(false);
  });
});
