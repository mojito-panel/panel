import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ActivityLog } from '~/db/entities';
import type { IActivityLog } from '~/db/types';
import { activityList } from '~/lists/activity';
import { listQueryBuilder, runListQuery } from '~/server/list/query';

import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { loadServerWithPermission, requirePanelPermission, requireUser } from '../session';

/** Serializable row returned to the client. */
export interface ActivityLogRow {
  id: string;
  event: string;
  description: string | null;
  ip: string | null;
  actorName: string | null;
  actorEmail: string | null;
  serverId: string | null;
  serverName: string | null;
  properties: string | null;
  createdAt: Date;
}

function toDto(row: IActivityLog): ActivityLogRow {
  return {
    id: row.id,
    event: row.event,
    description: row.description ?? null,
    ip: row.ip ?? null,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    serverId: row.serverId ?? null,
    serverName: row.serverName ?? null,
    properties: JSON.stringify(row.properties ?? {}),
    createdAt: row.createdAt,
  };
}

const serverActivityQuerySchema = activityList.querySchema.and(
  z.object({ serverId: z.string().min(1) }),
);

/** Activity of ONE server — any user holding `server.activity` read on it. */
export const listServerActivityFn = createServerFn({ method: 'POST' })
  .validator(serverActivityQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.activity': ['read'],
    });

    const qb = listQueryBuilder(em, ActivityLog, activityList);
    qb.andWhere({ serverId: server.id });

    const { rows, rowCount } = await runListQuery(qb, activityList.spec, data);
    return { rowCount, rows: rows.map(toDto) };
  });

/** Panel-wide activity — `panel.activity` read (admin by design: the log aggregates every server's events). */
export const listAllActivityFn = createServerFn({ method: 'POST' })
  .validator(activityList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.activity': ['read'] });

    const qb = listQueryBuilder(orm.em, ActivityLog, activityList);
    const { rows, rowCount } = await runListQuery(qb, activityList.spec, data);
    return { rowCount, rows: rows.map(toDto) };
  });
