import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { withOrmContext } from '../middleware';
import { Schedule } from '~/db/entities';
import { serverSchedulesList } from '~/lists/schedules';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { requireUser, HttpError, loadServerWithPermission } from '../session';
import { logActivity } from '../activity';
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  findScheduleTasks,
} from '../schedules';
import {
  createScheduleSchema,
  updateScheduleSchema,
  scheduleActionSchema,
} from '~/validators/schedules';

/**
 * Schedules (≈ Pelican's "Schedules" tab): cron-triggered task chains
 * (power actions / console commands with delays). The runner, the claim
 * semantics and the pg-boss chain live in `src/server/schedules.ts` —
 * these handlers only resolve permissions and persist.
 */

/** Serializable task row of the detail payload (MikroORM Opt values normalized). */
function taskDto(task: Awaited<ReturnType<typeof findScheduleTasks>>[number]) {
  return {
    id: task.id,
    sequenceId: Number(task.sequenceId),
    action: task.action as 'power' | 'command',
    payload: task.payload,
    timeOffset: Number(task.timeOffset ?? 0),
    continueOnFailure: Boolean(task.continueOnFailure),
  };
}

/** Serializable schedule row (list + detail share it, MikroORM Opt values normalized). */
function scheduleDto(schedule: {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  isActive: boolean;
  isProcessing: boolean;
  onlyWhenOnline: boolean;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
}) {
  return {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    isActive: Boolean(schedule.isActive),
    isProcessing: Boolean(schedule.isProcessing),
    onlyWhenOnline: Boolean(schedule.onlyWhenOnline),
    lastRunAt: schedule.lastRunAt ?? null,
    nextRunAt: schedule.nextRunAt ?? null,
  };
}

// ─── List ────────────────────────────────────────────────────────────────────

const listSchedulesQuerySchema = serverSchedulesList.querySchema.and(
  z.object({ serverId: z.string().min(1) }),
);

/** Schedules of ONE server — filter/sort/pagination run in the database. */
export const listSchedulesFn = createServerFn({ method: 'POST' })
  .validator(listSchedulesQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['read'],
    });

    const qb = listQueryBuilder(em, Schedule, serverSchedulesList);
    qb.andWhere({ serverId: server.id });

    const { rows, rowCount } = await runListQuery(qb, serverSchedulesList.spec, data);
    return { rowCount, rows: rows.map((schedule) => scheduleDto(schedule)) };
  });

// ─── Detail ──────────────────────────────────────────────────────────────────

/** One schedule + its task chain in execution order (detail page). */
export const getScheduleFn = createServerFn({ method: 'GET' })
  .validator(scheduleActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['read'],
    });

    const schedule = await em.findOne(Schedule, { id: data.scheduleId, serverId: server.id });
    if (!schedule) throw new HttpError(404, 'Planification introuvable');

    const tasks = await findScheduleTasks(schedule.id);
    return { ...scheduleDto(schedule), tasks: tasks.map(taskDto) };
  });

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createScheduleFn = createServerFn({ method: 'POST' })
  .validator(createScheduleSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['create'],
    });

    const { serverId: _serverId, ...input } = data;
    const schedule = await createSchedule(server, input);

    await logActivity({
      event: 'schedule:create',
      description: `Planification « ${schedule.name} » créée sur « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { scheduleId: schedule.id, cron: schedule.cron },
    });

    return scheduleDto(schedule);
  });

export const updateScheduleFn = createServerFn({ method: 'POST' })
  .validator(updateScheduleSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['update'],
    });

    const schedule = await em.findOne(Schedule, { id: data.scheduleId, serverId: server.id });
    if (!schedule) throw new HttpError(404, 'Planification introuvable');

    const { serverId: _serverId, scheduleId: _scheduleId, ...input } = data;
    await updateSchedule(schedule, input);

    await logActivity({
      event: 'schedule:update',
      description: `Planification « ${schedule.name} » modifiée sur « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { scheduleId: schedule.id, cron: schedule.cron },
    });

    return scheduleDto(schedule);
  });

export const deleteScheduleFn = createServerFn({ method: 'POST' })
  .validator(scheduleActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['delete'],
    });

    const schedule = await em.findOne(Schedule, { id: data.scheduleId, serverId: server.id });
    if (!schedule) throw new HttpError(404, 'Planification introuvable');

    await deleteSchedule(schedule);

    await logActivity({
      event: 'schedule:delete',
      description: `Planification « ${schedule.name} » supprimée de « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { scheduleId: schedule.id },
    });

    return { id: schedule.id, deleted: true };
  });

// ─── Run now ─────────────────────────────────────────────────────────────────

/** Manual trigger — claims the run and queues the first task immediately. */
export const runScheduleNowFn = createServerFn({ method: 'POST' })
  .validator(scheduleActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.schedules': ['update'],
    });

    const schedule = await em.findOne(Schedule, { id: data.scheduleId, serverId: server.id });
    if (!schedule) throw new HttpError(404, 'Planification introuvable');

    await runScheduleNow(schedule, server);

    await logActivity({
      event: 'schedule:run',
      description: `Planification « ${schedule.name} » exécutée manuellement sur « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { scheduleId: schedule.id, status: 'manual' },
    });

    return { id: schedule.id, status: 'processing' as const };
  });
