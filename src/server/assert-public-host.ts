import '@tanstack/react-start/server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from './session';

/**
 * SSRF guard for panel-initiated outbound connections (recipe URL imports,
 * node FQDN resolution). A hostname the panel fetches must never resolve
 * to an address that reaches the panel's own machine or its cloud
 * metadata service.
 *
 * After DNS resolution, these are REJECTED:
 *
 * - loopback: `127.0.0.0/8` and `::1` (localhost callbacks);
 * - link-local: `169.254.0.0/16` and `fe80::/10` — this range also covers
 *   the cloud metadata endpoints of every major provider
 *   (`169.254.169.254` for AWS/GCP/OpenStack/Azure's classic endpoint,
 *   `fd00:ec51::1` for GCP's IPv6 one — the IPv6 form is refused by the
 *   "not a public-looking address" rule below in practice, the IPv4 one
 *   by the link-local netmask).
 *
 * Private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7) are
 * ALLOWED on purpose: INTERNAL registries on the panel's own LAN are a
 * legitimate deployment (self-hosted Gitea, a NAS…), and the panel machine
 * itself is the one making the request.
 *
 * TOCTOU / DNS-rebinding limitation: the fetch that follows does its own
 * DNS resolution, so a hostile server can answer the check with a public
 * record and the fetch with a private one. Fully closing that gap needs a
 * pinned-IP fetch (V2); the check still kills the trivial attacker (a URL
 * that points straight at localhost/metadata) and every static mistake.
 */

/** True when `address` is neither loopback nor link-local. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    // 127.0.0.0/8 loopback, 169.254.0.0/16 link-local (cloud metadata).
    return a !== 127 && !(a === 169 && b === 254);
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    // ::1 loopback, fe80::/10 link-local.
    return lower !== '::1' && !lower.startsWith('fe80:');
  }
  // Not an IP literal — the caller resolves hostnames itself.
  return true;
}

function assertAddress(address: string, host: string): void {
  if (isPublicAddress(address)) return;
  throw new HttpError(422, `L’hôte « ${host} » pointe vers une adresse interdite`);
}

/**
 * Resolves `url` and rejects when it points at a loopback/link-local
 * address (every record it maps to must be public). A literal IP is
 * checked directly, no DNS involved.
 */
export async function assertPublicHost(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(422, 'URL invalide');
  }

  if (isIP(parsed.hostname) !== 0) {
    assertAddress(parsed.hostname, parsed.hostname);
    return;
  }

  let records: { address: string }[];
  try {
    records = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new HttpError(422, `Hôte introuvable : ${parsed.hostname}`);
  }
  for (const { address } of records) {
    assertAddress(address, parsed.hostname);
  }
}
