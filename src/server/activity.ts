import '@tanstack/react-start/server-only';
import { getRequestHeaders } from '@tanstack/react-start/server';

import { ActivityLog } from '~/db/entities';

import { orm } from './orm';

/**
 * Audit trail writer — Pelican-style `ActivityLog` rows (event, ip, actor,
 * description, structured properties) written OUTSIDE the caller's unit of
 * work, on a forked EM. An audit failure must never break the action that
 * produced it: every error is logged and swallowed.
 *
 * Rows are denormalized on purpose (actorId/actorName, serverId/serverName
 * snapshots) — an entry keeps describing the action even after the actor or
 * the server it mentions is deleted.
 */

export interface ActivityInput {
  /** Namespaced event — "server:power", "backup:create", "subuser:add"… */
  event: string;
  /** Human-readable summary of the action (what happened, to what). */
  description: string;
  /** Actor snapshot — the user who did it (null = system/anonymous). */
  actor?: { id: string; name: string | null; email: string } | null;
  /** Subject server of the event, if any (denormalized id + name). */
  server?: { id: string; name: string } | null;
  /** Structured context (changed fields, target ids…). */
  properties?: Record<string, unknown>;
}

/** Best-effort request metadata — absent (null) outside a request scope. */
function requestMetadata(): { ip: string | null; userAgent: string | null } {
  try {
    const headers = getRequestHeaders();
    const forwarded = headers.get('x-forwarded-for');
    return {
      // First hop of the proxy chain is the originating client
      ip: forwarded ? forwarded.split(',')[0].trim() : null,
      userAgent: headers.get('user-agent'),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    const { ip, userAgent } = requestMetadata();
    const em = orm.em.fork();
    em.persist(
      em.create(ActivityLog, {
        event: input.event,
        description: input.description,
        ip,
        userAgent,
        actorId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? null,
        actorEmail: input.actor?.email ?? null,
        serverId: input.server?.id ?? null,
        serverName: input.server?.name ?? null,
        properties: input.properties ?? {},
        createdAt: new Date(),
      }),
    );
    await em.flush();
  } catch (error) {
    console.error('[activity] failed to write activity log:', error);
  }
}
