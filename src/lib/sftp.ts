import { usernameSchema } from '~/validators/auth';

/**
 * SFTP helpers shared by the auth route and the UI (pure TypeScript — safe
 * on the client). The username format is `{username}.{serverId}`: a username
 * never contains dots (enforced by usernameSchema), so the split happens at
 * the LAST dot (same trick as Pelican's reversed-string parse). The serverId
 * is any non-empty string — the DB lookup is the real validation.
 */

/** Parses `{username}.{serverId}` — null when the shape is wrong. */
export function parseSftpUsername(username: string): { username: string; serverId: string } | null {
  const lastDot = username.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === username.length - 1) return null;
  const name = username.slice(0, lastDot);
  const serverId = username.slice(lastDot + 1);
  if (!usernameSchema.safeParse(name).success) return null;
  return { username: name, serverId };
}

/** Builds the SFTP username shown to a viewer (Settings page card). */
export function buildSftpUsername(username: string, serverId: string): string {
  return `${username}.${serverId}`;
}
