import '@tanstack/react-start/server-only';
import type { Job } from 'pg-boss';
import { Node, Schedule, ScheduleTask, Server } from '~/db/entities';
import type { INode, ISchedule, IScheduleTask, IServer } from '~/db/types';
import type { ServerAction } from '~/contract';
import { nanoid } from '~/lib/nanoid';
import { nextCronRun } from '~/lib/cron';
import { orm, runWithOrmContext } from './orm';
import { HttpError } from './session';
import { logActivity } from './activity';
import { getQueue, startQueue } from './queue';
import { executeServerAction, requireNodeOf } from './servers';
import { agentGetServer, agentSendCommand } from './agent/client';

/**
 * Schedules service (Pelican "Schedules" parity, server-only):
 *
 * - WHEN a run fires is owned by the `schedule` table: `next_run_at` is
 *   computed and persisted at write/claim time (croner, in the schedule's
 *   own timezone) and the tick only compares dates — exactly Pelican's
 *   `schedule:process` command, minus the system cron (Node is a
 *   long-running process, a plain interval does the job).
 * - HOW the tasks run is owned by pg-boss: each task is a durable job,
 *   and each job queues the next one with `startAfter` — the chain
 *   SURVIVES a panel restart (delayed jobs live in Postgres). This is
 *   the piece Pelican gets from its Laravel queue.
 * - `is_processing` claims a run: the tick flips it in one conditional
 *   UPDATE, so a "run now" racing the tick cannot double-fire — the
 *   loser sees zero affected rows and backs off.
 *
 * Anti-stuck (the bug Pelican patched after schedules died for 24 h):
 * a boot sweep releases the claims of a previous process, a periodic
 * sweeper releases chains whose claim outlives the longest possible run,
 * and task jobs carry `retryLimit: 0` + `expireInSeconds` so a handler
 * killed with the process can never hang active forever.
 */

/** pg-boss queue carrying the task-chain jobs. */
const SCHEDULE_TASK_QUEUE = 'schedule-task';

/** How often due schedules are scanned (Pelican: every minute; a tighter window catches up faster). */
const TICK_INTERVAL_MS = 30_000;

/**
 * Longest a legitimate chain can run: 10 tasks × (900 s of offset + the
 * 30 s bound on each agent call) = 9300 s ≈ 2.6 h — the 3 h bound stays
 * above it, so the sweeper only releases DEAD claims.
 */
const STUCK_CHAIN_MS = 3 * 60 * 60 * 1000;

/**
 * Bound on every agent call the runner makes (online gate, power actions,
 * console commands) — a hung agent connection must never stall a task job
 * past its `expireInSeconds` window without a clean failure.
 */
const AGENT_CALL_TIMEOUT_MS = 30_000;

/**
 * Task job options — Pelican semantics: no retries (a failed task ends or
 * continues per `continue_on_failure`, it is never re-attempted), and a
 * bounded active window so a crashed handler expires instead of hanging.
 */
const TASK_JOB_OPTIONS = { retryLimit: 0, expireInSeconds: 120 } as const;

/** Payload of a task-chain job: which schedule, which step. */
interface ScheduleTaskJobData {
  scheduleId: string;
  sequenceId: number;
}

/** A task as submitted by the create/update server functions (validated by the caller). */
export interface ScheduleTaskInput {
  action: 'power' | 'command';
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
}

export interface ScheduleInput {
  name: string;
  cron: string;
  timezone: string;
  onlyWhenOnline: boolean;
  tasks: ScheduleTaskInput[];
}

// ─── Next-run computation ─────────────────────────────────────────────────────

/** Next occurrence of a schedule (422 on an invalid pattern/timezone — write-time guards). */
function computeNextRun(cron: string, timezone: string): Date {
  const next = nextCronRun(cron, timezone);
  if (!next) {
    throw new HttpError(422, 'Expression cron ou fuseau horaire invalide');
  }
  return next;
}

// ─── CRUD (used by src/server/functions/schedules.ts) ────────────────────────

/** Tasks of a schedule in execution order. */
export async function findScheduleTasks(scheduleId: string): Promise<IScheduleTask[]> {
  return orm.em.find(ScheduleTask, { scheduleId }, { orderBy: { sequenceId: 'asc' } });
}

/** Replaces the whole task list of a schedule (renumbered 1..n, Pelican-style). */
async function replaceTasks(scheduleId: string, tasks: ScheduleTaskInput[]): Promise<void> {
  const em = orm.em;
  const existing = await em.find(ScheduleTask, { scheduleId });
  em.remove(existing);
  const now = new Date();
  let sequenceId = 1;
  for (const task of tasks) {
    em.persist(
      em.create(ScheduleTask, {
        id: nanoid(),
        scheduleId,
        sequenceId: sequenceId++,
        action: task.action,
        payload: task.payload,
        timeOffset: task.timeOffset,
        continueOnFailure: task.continueOnFailure,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
}

/** Creates a schedule with its task chain — `next_run_at` computed from now. */
export async function createSchedule(server: IServer, input: ScheduleInput): Promise<ISchedule> {
  const em = orm.em;
  const now = new Date();
  const schedule = em.create(Schedule, {
    id: nanoid(),
    serverId: server.id,
    name: input.name,
    cron: input.cron,
    timezone: input.timezone,
    isActive: true,
    isProcessing: false,
    onlyWhenOnline: input.onlyWhenOnline,
    lastRunAt: null,
    nextRunAt: computeNextRun(input.cron, input.timezone),
    createdAt: now,
    updatedAt: now,
  });
  em.persist(schedule);
  await em.flush();
  await replaceTasks(schedule.id, input.tasks);
  await em.flush();
  return schedule;
}

/**
 * Updates a schedule and REPLACES its tasks. `next_run_at` is recomputed
 * (Pelican parity); a chain queued before the edit keeps running on the
 * NEW task definitions at its next step (sequence ids are stable).
 */
export async function updateSchedule(
  schedule: ISchedule,
  input: ScheduleInput & { isActive: boolean },
): Promise<void> {
  const em = orm.em;
  schedule.name = input.name;
  schedule.cron = input.cron;
  schedule.timezone = input.timezone;
  schedule.isActive = input.isActive;
  schedule.onlyWhenOnline = input.onlyWhenOnline;
  schedule.nextRunAt = computeNextRun(input.cron, input.timezone);
  await em.flush();
  await replaceTasks(schedule.id, input.tasks);
  await em.flush();
}

/** Deletes a schedule and its tasks — queued chain jobs become no-ops. */
export async function deleteSchedule(schedule: ISchedule): Promise<void> {
  const em = orm.em;
  const tasks = await em.find(ScheduleTask, { scheduleId: schedule.id });
  em.remove(tasks);
  em.remove(schedule);
  await em.flush();
}

// ─── Run triggering (tick + "run now") ────────────────────────────────────────

/**
 * Atomically claims a run: flips `is_processing` and advances `next_run_at`
 * in ONE conditional UPDATE. Concurrent claimants (tick vs "run now") see
 * zero affected rows and back off — the equivalent of Pelican's
 * ProcessScheduleService transaction, without needing a lock.
 */
async function claimRun(schedule: ISchedule): Promise<boolean> {
  const affected = await orm.em.nativeUpdate(
    Schedule,
    { id: schedule.id, isProcessing: false },
    { isProcessing: true, nextRunAt: computeNextRun(schedule.cron, schedule.timezone), updatedAt: new Date() },
  );
  return affected === 1;
}

/** Ends a run: releases the claim and stamps `last_run_at` (Pelican markScheduleComplete). */
async function completeRun(scheduleId: string): Promise<void> {
  await orm.em.nativeUpdate(
    Schedule,
    { id: scheduleId },
    { isProcessing: false, lastRunAt: new Date(), updatedAt: new Date() },
  );
}

/** True when the server is up (starting counts, crashed/stopped/stopping do not). */
async function isServerOnline(node: INode | null, server: IServer): Promise<boolean> {
  if (!node) return false;
  try {
    const info = await agentGetServer(node, server.id, {
      signal: AbortSignal.timeout(AGENT_CALL_TIMEOUT_MS),
    });
    return info.status === 'running' || info.status === 'starting';
  } catch {
    // Agent unreachable — Pelican skips the run too (a schedule must never
    // fire blind on a server it cannot see).
    return false;
  }
}

/** Enqueues the first task of a claimed schedule (delayed by its own time offset). */
async function queueFirstTask(schedule: ISchedule, delaySeconds: number): Promise<void> {
  const tasks = await findScheduleTasks(schedule.id);
  if (tasks.length === 0) return;
  await getQueue().sendAfter(
    SCHEDULE_TASK_QUEUE,
    { scheduleId: schedule.id, sequenceId: tasks[0].sequenceId },
    TASK_JOB_OPTIONS,
    delaySeconds,
  );
}

/**
 * Claims and queues one schedule run. Returns false when another claimant
 * won, when the schedule has no tasks (Pelican leaves those pending, not
 * consumed), or when the `only_when_online` gate skips the occurrence.
 */
async function fireSchedule(
  schedule: ISchedule,
  server: IServer,
  options: { manual: boolean },
): Promise<boolean> {
  const tasks = await findScheduleTasks(schedule.id);
  if (tasks.length === 0) return false;

  if (!await claimRun(schedule)) return false;

  // The occurrence is consumed either way once claimed — an offline
  // server skips it (Pelican marks the run complete on the skip).
  if (schedule.onlyWhenOnline) {
    const node = await orm.em.findOne(Node, { id: server.nodeId });
    if (!(await isServerOnline(node, server))) {
      await completeRun(schedule.id);
      await logActivity({
        event: 'schedule:run',
        description: `Planification « ${schedule.name} » ignorée : « ${server.name} » est hors ligne`,
        server: { id: server.id, name: server.name },
        properties: { scheduleId: schedule.id, status: 'skipped' },
      });
      return false;
    }
  }

  // Pelican parity: a scheduled run waits out the first task's offset, a
  // manual "run now" fires immediately.
  await queueFirstTask(schedule, options.manual ? 0 : (tasks[0].timeOffset ?? 0));
  return true;
}

/** "Run now" — manual trigger of a schedule (409 while one is already running). */
export async function runScheduleNow(schedule: ISchedule, server: IServer): Promise<void> {
  if (schedule.isProcessing) {
    throw new HttpError(409, 'Cette planification est déjà en cours d’exécution');
  }
  const tasks = await findScheduleTasks(schedule.id);
  if (tasks.length === 0) {
    throw new HttpError(422, 'Ajoute au moins une tâche avant d’exécuter cette planification');
  }
  if (!await claimRun(schedule)) {
    throw new HttpError(409, 'Cette planification est déjà en cours d’exécution');
  }
  if (schedule.onlyWhenOnline) {
    const node = await orm.em.findOne(Node, { id: server.nodeId });
    if (!(await isServerOnline(node, server))) {
      await completeRun(schedule.id);
      // The occurrence is consumed — log the skip BEFORE the 409 so the
      // activity trail explains the missing run.
      await logActivity({
        event: 'schedule:run',
        description: `Planification « ${schedule.name} » ignorée : « ${server.name} » est hors ligne`,
        server: { id: server.id, name: server.name },
        properties: { scheduleId: schedule.id, status: 'skipped' },
      });
      throw new HttpError(409, `« ${server.name} » est hors ligne`);
    }
  }
  await queueFirstTask(schedule, 0);
}

// ─── Tick (the Pelican schedule:process scan) ────────────────────────────────

/**
 * Scans due schedules and fires them. Never throws: one failing schedule
 * must not kill the run group (Pelican's ProcessRunnableCommand comment
 * verbatim), and the sweeper releases dead chains first.
 */
export async function tickSchedules(): Promise<void> {
  const em = orm.em;

  // Sweeper: a claim older than the longest possible chain belongs to a
  // dead run (panel crash mid-chain, expired job) — release it so the
  // next occurrence can fire.
  await em.nativeUpdate(
    Schedule,
    { isProcessing: true, updatedAt: { $lt: new Date(Date.now() - STUCK_CHAIN_MS) } },
    { isProcessing: false },
  );

  const due = await em.find(Schedule, {
    isActive: true,
    isProcessing: false,
    nextRunAt: { $lte: new Date() },
  });
  if (due.length === 0) return;

  // Pelican filters out suspended/installing servers at the query level.
  const servers = await em.find(Server, { id: { $in: [...new Set(due.map((s) => s.serverId))] } });
  const runnable = new Map(
    servers
      .filter(
        (server) =>
          !server.suspended &&
          server.status !== 'installing' &&
          server.status !== 'install_failed',
      )
      .map((server) => [server.id, server]),
  );

  for (const schedule of due) {
    const server = runnable.get(schedule.serverId);
    if (!server) continue;
    try {
      await fireSchedule(schedule, server, { manual: false });
    } catch (error) {
      console.error(`[schedules] failed to run schedule ${schedule.id}:`, error);
    }
  }
}

// ─── Task execution (the Pelican RunTaskJob chain) ───────────────────────────

/** Logs a completed run — `status` carries the outcome in the properties. */
async function logScheduleRun(
  schedule: ISchedule,
  server: IServer,
  status: 'completed' | 'failed',
  properties: Record<string, unknown> = {},
): Promise<void> {
  await logActivity({
    event: 'schedule:run',
    description:
      status === 'completed'
        ? `Planification « ${schedule.name} » exécutée sur « ${server.name} »`
        : `Planification « ${schedule.name} » interrompue sur « ${server.name} »`,
    server: { id: server.id, name: server.name },
    properties: { scheduleId: schedule.id, status, ...properties },
  });
}

/**
 * Executes one task of a chain, then either queues the next one (after
 * its own time offset) or completes the run. `continueOnFailure` lets an
 * agent failure chain onward (Pelican: a ConnectionException on such a
 * task does not stop the queue) — anything else ends the run.
 */
async function runScheduleTask(data: ScheduleTaskJobData): Promise<void> {
  const em = orm.em;
  const schedule = await em.findOne(Schedule, { id: data.scheduleId });
  if (!schedule) return; // deleted mid-chain — nothing to complete
  const server = await em.findOne(Server, { id: schedule.serverId });
  if (!server) return;

  // Deactivated, suspended or reinstalling between two tasks: end the
  // chain cleanly (Pelican's RunTaskJob does the same on the first two
  // conditions). A (re)install wipes the install dir — firing a power
  // action or a console command into it must never happen.
  const reinstalling =
    server.status === 'installing' || server.status === 'install_failed';
  if (!schedule.isActive || server.suspended || reinstalling) {
    await completeRun(schedule.id);
    await logScheduleRun(
      schedule,
      server,
      'failed',
      {
        reason: !schedule.isActive
          ? 'deactivated'
          : server.suspended
            ? 'suspended'
            : 'reinstalling',
      },
    );
    return;
  }

  const task = await em.findOne(ScheduleTask, {
    scheduleId: schedule.id,
    sequenceId: data.sequenceId,
  });
  if (!task) {
    // Tasks were replaced mid-chain — the sequence no longer exists.
    await completeRun(schedule.id);
    await logScheduleRun(schedule, server, 'failed', { reason: 'tasks-replaced' });
    return;
  }

  let failure: string | null = null;
  try {
    if (task.action === 'power') {
      // The shared power service: suspended guard, limits sync, agent
      // call, status writeback + its own 'server:power' activity log.
      await executeServerAction(server, task.payload as ServerAction, {
        signal: AbortSignal.timeout(AGENT_CALL_TIMEOUT_MS),
      });
    } else {
      const node = await requireNodeOf(server);
      await agentSendCommand(node, server.id, task.payload, {
        signal: AbortSignal.timeout(AGENT_CALL_TIMEOUT_MS),
      });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (!task.continueOnFailure) {
      await completeRun(schedule.id);
      await logScheduleRun(schedule, server, 'failed', {
        sequenceId: task.sequenceId,
        action: task.action,
        error: failure,
      });
      return;
    }
    // Chain continues — log the swallowed task failure for the audit trail.
    await logActivity({
      event: 'schedule:run',
      description: `Tâche ${task.sequenceId} de « ${schedule.name} » a échoué — la chaîne continue`,
      server: { id: server.id, name: server.name },
      properties: {
        scheduleId: schedule.id,
        status: 'task-failed',
        sequenceId: task.sequenceId,
        action: task.action,
        error: failure,
      },
    });
  }

  // Queue the next task after its own delay — the chain lives in Postgres,
  // a panel restart before the delay elapses does not lose it.
  const next = await em.findOne(
    ScheduleTask,
    { scheduleId: schedule.id, sequenceId: { $gt: task.sequenceId } },
    { orderBy: { sequenceId: 'asc' } },
  );
  if (next) {
    await getQueue().sendAfter(
      SCHEDULE_TASK_QUEUE,
      { scheduleId: schedule.id, sequenceId: next.sequenceId },
      TASK_JOB_OPTIONS,
      next.timeOffset ?? 0,
    );
    return;
  }

  await completeRun(schedule.id);
  await logScheduleRun(schedule, server, 'completed', failure ? { lastTaskError: failure } : {});
}

/** pg-boss work handler — one request context per job (batchSize is 1). */
async function handleTaskJobs(jobs: Job<ScheduleTaskJobData>[]): Promise<void> {
  for (const job of jobs) {
    await runWithOrmContext(() => runScheduleTask(job.data));
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

/**
 * Starts the schedule runner: the pg-boss worker, the boot sweep and the
 * tick interval. Called once from `src/server.ts` after `startQueue()`.
 *
 * A global flag keeps ONE runner per process — dev SSR reloads re-evaluate
 * server modules and must not stack interval loops on top of each other.
 */
export function startScheduleRunner(): void {
  const guard = globalThis as { __mojitoScheduleRunner?: boolean };
  if (guard.__mojitoScheduleRunner) return;
  guard.__mojitoScheduleRunner = true;

  void (async () => {
    const boss = await startQueue();
    // The queue must exist before the worker polls it (a fresh database has
    // none — send() would create it, but only at the first fire). Idempotent
    // (ON CONFLICT DO NOTHING) and carries the task job defaults.
    await boss.createQueue(SCHEDULE_TASK_QUEUE, TASK_JOB_OPTIONS);
    await boss.work(SCHEDULE_TASK_QUEUE, { batchSize: 1 }, handleTaskJobs);

    // Boot sweep: release the claims of a previous process. Delayed jobs
    // still queued in pg-boss resume on their own (the handler does not
    // read the claim flag), and `next_run_at` was already advanced at
    // claim time, so no occurrence can double-fire.
    //
    // SINGLE-INSTANCE assumption: this sweep (and the claim/`is_processing`
    // semantics in general) presumes ONE panel process owns the runner —
    // two live instances would each release the other's claims and
    // double-fire chains. Dev reloads are covered by the global guard
    // above; production is a single process (see src/server.ts). The
    // warning below makes a mistaken multi-instance deployment visible.
    console.warn(
      '[schedules] single-instance assumption: the runner must be the only panel process',
    );
    await runWithOrmContext(() =>
      orm.em.nativeUpdate(Schedule, { isProcessing: true }, { isProcessing: false }),
    );
    await runWithOrmContext(tickSchedules);

    setInterval(() => {
      void runWithOrmContext(tickSchedules).catch((error) =>
        console.error('[schedules] tick failed:', error),
      );
    }, TICK_INTERVAL_MS);
    console.log('[bootstrap] schedule runner started');
  })().catch((error) => {
    console.error('[schedules] runner failed to start:', error);
    guard.__mojitoScheduleRunner = false;
  });
}
