import { z } from 'zod';
import { isValidCron, isValidTimezone } from '~/lib/cron';

/**
 * Schedules (Pelican "Schedules" tab) — form + wire schemas.
 *
 * The cron is a 5-field unix expression stored as ONE string (validated
 * by croner, previewed by `cronToHuman`); the timezone is per-schedule
 * (IANA) and evaluated at next-run computation time.
 */

/** Schedule name — free-form label (never interpolated into configs). */
export const scheduleNameField = z
  .string()
  .trim()
  .min(2, 'Le nom doit faire au moins 2 caractères')
  .max(128, 'Le nom doit faire au plus 128 caractères');

/** 5-field unix cron expression — validated by croner, not just by shape. */
export const cronField = z
  .string()
  .trim()
  .min(1, 'L’expression cron est requise')
  .max(64)
  .refine(isValidCron, 'Expression cron invalide (5 champs attendus : m h dom mon dow)');

/** IANA timezone name the cron is evaluated in. */
export const timezoneField = z
  .string()
  .min(1, 'Le fuseau horaire est requis')
  .max(64)
  .refine(isValidTimezone, 'Fuseau horaire inconnu');

/** Longest delay between two tasks of a chain (Pelican: 0-900 seconds). */
export const taskTimeOffsetField = z
  .number()
  .int()
  .min(0, 'Le délai doit être >= 0 s')
  .max(900, 'Le délai doit être <= 900 s (15 minutes)');

/** One task of a chain — the payload shape depends on the action. */
export const scheduleTaskSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('power'),
    payload: z.enum(['start', 'stop', 'restart', 'kill']),
    timeOffset: taskTimeOffsetField,
    continueOnFailure: z.boolean(),
  }),
  z.object({
    action: z.literal('command'),
    payload: z
      .string()
      .trim()
      .min(1, 'La commande est vide')
      .max(191, 'La commande doit faire au plus 191 caractères'),
    timeOffset: taskTimeOffsetField,
    continueOnFailure: z.boolean(),
  }),
]);

export type ScheduleTaskDto = z.infer<typeof scheduleTaskSchema>;

/**
 * The shared shape of the schedule form — the create dialog and the
 * detail page render the SAME form (Pelican parity: name, cron and the
 * task chain in one place), so a schedule is always created runnable.
 */
export const scheduleFormSchema = z.object({
  name: scheduleNameField,
  cron: cronField,
  timezone: timezoneField,
  onlyWhenOnline: z.boolean(),
  tasks: z
    .array(scheduleTaskSchema)
    .min(1, 'Ajoute au moins une tâche')
    .max(10, 'Une planification fait au plus 10 tâches'),
});

export type ScheduleFormDto = z.infer<typeof scheduleFormSchema>;

/** Detail page form — the create dialog cannot toggle the active state. */
export const scheduleEditFormSchema = scheduleFormSchema.extend({
  isActive: z.boolean(),
});

export type ScheduleEditFormDto = z.infer<typeof scheduleEditFormSchema>;

/** Creates a schedule (its tasks included) on a server — active by default. */
export const createScheduleSchema = scheduleFormSchema.and(
  z.object({ serverId: z.string().min(1) }),
);

export type CreateScheduleDto = z.infer<typeof createScheduleSchema>;

/** Updates a schedule — the whole task list is replaced each time. */
export const updateScheduleSchema = scheduleEditFormSchema.and(
  z.object({ serverId: z.string().min(1), scheduleId: z.string().min(1) }),
);

export type UpdateScheduleDto = z.infer<typeof updateScheduleSchema>;

/** Loads one schedule of a server (detail page, deletion, "run now"). */
export const scheduleActionSchema = z.object({
  serverId: z.string().min(1),
  scheduleId: z.string().min(1),
});

export type ScheduleActionDto = z.infer<typeof scheduleActionSchema>;
