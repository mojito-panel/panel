import { describe, expect, it } from 'vitest';
import { cronToHuman } from '~/lib/cron';

/**
 * cronToHuman — French summaries of the cron patterns the schedules UI
 * produces; everything unrecognized falls back to the raw expression.
 */
describe('cronToHuman', () => {
  it('renders every-minute', () => {
    expect(cronToHuman('* * * * *')).toBe('Toutes les minutes');
  });

  it('renders step-minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Toutes les 5 minutes');
    expect(cronToHuman('*/15 * * * *')).toBe('Toutes les 15 minutes');
  });

  it('renders step-hours instead of echoing the literal */2 (regression)', () => {
    // `0 */2 * * *` used to render "Tous les jours à */2:00"
    expect(cronToHuman('0 */2 * * *')).toBe('Toutes les 2 heures');
    expect(cronToHuman('0 */6 * * *')).toBe('Toutes les 6 heures');
  });

  it('renders daily at a plain time', () => {
    expect(cronToHuman('30 14 * * *')).toBe('Tous les jours à 14:30');
    expect(cronToHuman('0 0 * * *')).toBe('Tous les jours à 00:00');
    expect(cronToHuman('5 9 * * *')).toBe('Tous les jours à 09:05');
  });

  it('renders a day-of-week schedule', () => {
    expect(cronToHuman('0 9 * * 1')).toBe('Tous les lundis à 09:00');
    expect(cronToHuman('0 9 * * 0')).toBe('Tous les dimanches à 09:00');
    expect(cronToHuman('30 22 * * 7')).toBe('Tous les dimanches à 22:30');
  });

  it('falls back to the raw expression for unrecognized shapes', () => {
    // Day-of-month / month filters, lists and ranges stay verbatim
    expect(cronToHuman('30 4 1,15 * *')).toBe('30 4 1,15 * *');
    expect(cronToHuman('0 9 1-7 * *')).toBe('0 9 1-7 * *');
    expect(cronToHuman('0 9 * 12 1')).toBe('0 9 * 12 1');
    expect(cronToHuman('30 14 * * * 30 14')).toBe('30 14 * * * 30 14');
  });
});
