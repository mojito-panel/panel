import { z } from 'zod';

/**
 * SFTP helpers shared by the auth route and the UI (pure TypeScript — safe
 * on the client). The username format is `{email}.{serverId}`: emails may
 * contain dots, a UUID never does — so the split happens at the LAST dot
 * (same trick as Pelican's reversed-string parse).
 */

const uuidSchema = z.string().uuid();

/** Parses `{email}.{serverId}` — null when the shape is wrong. */
export function parseSftpUsername(username: string): { email: string; serverId: string } | null {
  const lastDot = username.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === username.length - 1) return null;
  const email = username.slice(0, lastDot);
  const serverId = username.slice(lastDot + 1);
  if (!uuidSchema.safeParse(serverId).success) return null;
  return { email, serverId };
}

/** Builds the SFTP username shown to a viewer (Settings page card). */
export function buildSftpUsername(email: string, serverId: string): string {
  return `${email}.${serverId}`;
}
