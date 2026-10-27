import { describe, it, expect } from 'vitest';
import {
  createScheduleSchema,
  updateScheduleSchema,
  scheduleEditFormSchema,
  scheduleActionSchema,
} from '~/validators/schedules';

/** Schedule wire schemas (server functions) + the shared form schema. */

const BASE = {
  name: 'Redémarrage quotidien',
  cron: '0 4 * * *',
  timezone: 'Europe/Paris',
  onlyWhenOnline: false,
  isActive: true,
  tasks: [
    { action: 'command', payload: 'say Restart in 1 minute', timeOffset: 0, continueOnFailure: false },
    { action: 'power', payload: 'restart', timeOffset: 60, continueOnFailure: true },
  ],
};

describe('schedule validators', () => {
  it('accepts a create request and strips the form-only isActive field', () => {
    const result = createScheduleSchema.safeParse({ ...BASE, serverId: 'server-1' });
    expect(result.success).toBe(true);
    if (result.success) expect('isActive' in result.data).toBe(false);
  });

  it('rejects an invalid cron expression', () => {
    const result = createScheduleSchema.safeParse({ ...BASE, serverId: 's', cron: '60 * * * *' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown timezone', () => {
    const result = createScheduleSchema.safeParse({
      ...BASE,
      serverId: 's',
      timezone: 'Mars/Olympus',
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one task and caps the chain at 10', () => {
    const empty = createScheduleSchema.safeParse({ ...BASE, serverId: 's', tasks: [] });
    expect(empty.success).toBe(false);

    const tasks = Array.from({ length: 11 }, () => BASE.tasks[0]);
    const overflowing = createScheduleSchema.safeParse({ ...BASE, serverId: 's', tasks });
    expect(overflowing.success).toBe(false);
  });

  it('binds the power payload to the action set and bounds the delay', () => {
    const badPower = createScheduleSchema.safeParse({
      ...BASE,
      serverId: 's',
      tasks: [{ action: 'power', payload: 'reboot', timeOffset: 0, continueOnFailure: false }],
    });
    expect(badPower.success).toBe(false);

    const late = createScheduleSchema.safeParse({
      ...BASE,
      serverId: 's',
      tasks: [{ action: 'power', payload: 'stop', timeOffset: 901, continueOnFailure: false }],
    });
    expect(late.success).toBe(false);
  });

  it('requires a non-empty command payload', () => {
    const emptyCommand = createScheduleSchema.safeParse({
      ...BASE,
      serverId: 's',
      tasks: [{ action: 'command', payload: '   ', timeOffset: 0, continueOnFailure: false }],
    });
    expect(emptyCommand.success).toBe(false);
  });

  it('keeps isActive on the edit form and update wire schemas', () => {
    expect(scheduleEditFormSchema.safeParse(BASE).success).toBe(true);

    const result = updateScheduleSchema.safeParse({ ...BASE, serverId: 's', scheduleId: 'sc-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(true);

    const missing = updateScheduleSchema.safeParse({
      ...BASE,
      serverId: 's',
      scheduleId: 'sc-1',
      isActive: undefined,
    });
    expect(missing.success).toBe(false);
  });

  it('requires both ids on a schedule action request', () => {
    expect(scheduleActionSchema.safeParse({ serverId: 's' }).success).toBe(false);
    expect(
      scheduleActionSchema.safeParse({ serverId: 's', scheduleId: 'sc-1' }).success,
    ).toBe(true);
  });
});
