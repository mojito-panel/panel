import { describe, expect, it, vi } from 'vitest';

import { isPublicAddress, assertPublicHost } from '../src/server/assert-public-host';

/**
 * SSRF guard tests (~/server/assert-public-host): the panel's outbound
 * fetches must never reach loopback or the cloud-metadata range, while
 * private LAN ranges stay allowed (internal registries are legitimate).
 *
 * `~/server/session` is mocked to a stub: the real one drags better-auth
 * (and its DB pool) plus the ORM singleton into the test process — with
 * Postgres down their async connection failures can escape as unhandled
 * rejections and poison the exit code. The helper only needs the
 * HttpError SHAPE (status + message).
 */
vi.mock('~/server/session', () => {
  class HttpError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { HttpError };
});

describe('isPublicAddress', () => {
  it('rejects the IPv4 loopback range', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('127.8.8.8')).toBe(false);
  });

  it('rejects the IPv4 link-local range (cloud metadata included)', () => {
    expect(isPublicAddress('169.254.169.254')).toBe(false); // AWS/GCP/Azure metadata
    expect(isPublicAddress('169.254.0.1')).toBe(false);
  });

  it('rejects the IPv6 loopback and link-local ranges', () => {
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
    expect(isPublicAddress('FE80:ABCD::1')).toBe(false);
  });

  it('allows public addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('allows PRIVATE ranges on purpose — internal registries are legitimate', () => {
    expect(isPublicAddress('10.0.0.5')).toBe(true);
    expect(isPublicAddress('172.16.1.10')).toBe(true);
    expect(isPublicAddress('192.168.1.10')).toBe(true);
    expect(isPublicAddress('fd00:ec51::1')).toBe(true);
  });
});

describe('assertPublicHost', () => {
  it('rejects a literal loopback IP without any DNS lookup', async () => {
    await expect(assertPublicHost('http://127.0.0.1/recipe.json')).rejects.toThrow();
    await expect(assertPublicHost('http://[::1]/recipe.json')).rejects.toThrow();
  });

  it('rejects the cloud metadata endpoint', async () => {
    await expect(assertPublicHost('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
  });

  it('accepts a literal public IP', async () => {
    await expect(assertPublicHost('http://8.8.8.8/recipe.json')).resolves.toBeUndefined();
  });

  it('accepts a private LAN address (internal registry)', async () => {
    await expect(assertPublicHost('http://192.168.1.10/recipe.json')).resolves.toBeUndefined();
  });

  it('rejects an unparseable URL', async () => {
    await expect(assertPublicHost('not a url')).rejects.toThrow();
  });

  it('rejects a hostname that does not resolve', async () => {
    await expect(assertPublicHost('http://mojito-ssrf-test.invalid/recipe.json')).rejects.toThrow();
  });
});
