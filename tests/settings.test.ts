import { MikroORM } from '@mikro-orm/sqlite';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

import { Setting } from '~/db/entities';
import {
  SETTING_DEFAULTS,
  SETTING_KEY_LIST,
  formatSettingBool,
  parseSettingBool,
  settingEnvName,
} from '~/lib/settings';
import {
  envForcedKey,
  getBranding,
  getSettingValue,
  isRegistrationEnabled,
  resolveSettings,
  writeSettings,
} from '~/server/settings';
import { updateGeneralSettingsSchema, updateMailSettingsSchema } from '~/validators/settings';

const SECRET = 'settings-test-secret-0123456789abcdef';

/**
 * The resolution service takes NO em parameter (services use the panel's
 * ORM singleton through `orm.em`, like every service) — so the test swaps
 * `~/server/orm` for the SQLite in-memory instance it seeds. `ormHolder.em`
 * is filled in beforeAll; the mock module is hoisted above every import.
 */
const ormHolder = vi.hoisted(() => ({ em: undefined as unknown }));
vi.mock('~/server/orm', () => ({ orm: ormHolder }));

// ─── Catalog (pure) ──────────────────────────────────────────────────────────

describe('settings catalog', () => {
  it('maps every key to its MOJITO_* env var name', () => {
    expect(settingEnvName('app:name')).toBe('MOJITO_APP_NAME');
    expect(settingEnvName('app:registration_enabled')).toBe('MOJITO_APP_REGISTRATION_ENABLED');
    expect(settingEnvName('mail:smtp:host')).toBe('MOJITO_MAIL_SMTP_HOST');
    expect(settingEnvName('mail:from:address')).toBe('MOJITO_MAIL_FROM_ADDRESS');
  });

  it('has a code default for every catalog key', () => {
    for (const key of SETTING_KEY_LIST) {
      expect(typeof SETTING_DEFAULTS[key]).toBe('string');
    }
  });

  it('serializes booleans as stored text values', () => {
    expect(formatSettingBool(true)).toBe('true');
    expect(formatSettingBool(false)).toBe('false');
    expect(parseSettingBool('true')).toBe(true);
    expect(parseSettingBool('false')).toBe(false);
    expect(parseSettingBool('nonsense')).toBe(false);
  });
});

// ─── Resolution service (SQLite in-memory) ────────────────────────────────────

describe('settings resolution', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [Setting],
      // The service reaches `orm.em` directly (no request context here):
      // the global SQLite EM must be usable.
      allowGlobalContext: true,
    });
    await orm.schema.create();
    ormHolder.em = orm.em;
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', SECRET);
    // Isolate every test: a clean `setting` table (defaults apply) and a
    // clean identity map — the service reads through the global EM.
    await orm.em.fork().nativeDelete(Setting, {});
    orm.em.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to the code defaults when no row exists', async () => {
    const { values, forced } = await resolveSettings();
    expect(values['app:name']).toBe(SETTING_DEFAULTS['app:name']);
    expect(values['mail:smtp:port']).toBe('587');
    expect(forced).toEqual({});
  });

  it('lets a stored row override the default', async () => {
    await writeSettings({ 'app:name': 'My Panel' });
    expect(await getSettingValue('app:name')).toBe('My Panel');
  });

  it('forces the env var over the stored row', async () => {
    // The DB row must exist BEFORE the env var is set — a forced key is
    // never written by writeSettings (see the skip test below).
    await writeSettings({ 'app:name': 'DB Panel' });
    vi.stubEnv('MOJITO_APP_NAME', 'Env Panel');
    expect(envForcedKey('app:name')).toBe('MOJITO_APP_NAME');
    const { values, forced } = await resolveSettings();
    expect(values['app:name']).toBe('Env Panel');
    expect(forced['app:name']).toBe('MOJITO_APP_NAME');
    // An empty env var is ignored (unset semantics)
    vi.stubEnv('MOJITO_APP_NAME', '');
    expect(await getSettingValue('app:name')).toBe('DB Panel');
  });

  it('encrypts secret keys at rest and reads them back in clear', async () => {
    await writeSettings({ 'mail:smtp:password': 'smtp-secret' });
    const row = await orm.em.fork().findOne(Setting, { key: 'mail:smtp:password' });
    expect(row?.value).not.toBe('smtp-secret');
    expect(row?.value.startsWith('enc:v1:')).toBe(true);
    // Non-secret keys stay plaintext
    await writeSettings({ 'mail:smtp:host': 'smtp.example.com' });
    const hostRow = await orm.em.fork().findOne(Setting, { key: 'mail:smtp:host' });
    expect(hostRow?.value).toBe('smtp.example.com');
    // And the effective value is the usable plaintext
    expect(await getSettingValue('mail:smtp:password')).toBe('smtp-secret');
  });

  it('skips env-forced keys on write (the DB value stays untouched)', async () => {
    vi.stubEnv('MOJITO_MAIL_SMTP_HOST', 'forced.example.com');
    const written = await writeSettings({
      'mail:smtp:host': 'written.example.com',
      'mail:smtp:username': 'mailer',
    });
    expect(written).toEqual(['mail:smtp:username']);
    const row = await orm.em.fork().findOne(Setting, { key: 'mail:smtp:host' });
    expect(row).toBeNull();
    expect(await getSettingValue('mail:smtp:host')).toBe('forced.example.com');
  });

  it('resolves the registration toggle (default, DB override, env force)', async () => {
    expect(await isRegistrationEnabled()).toBe(true);
    await writeSettings({ 'app:registration_enabled': 'false' });
    expect(await isRegistrationEnabled()).toBe(false);
    vi.stubEnv('MOJITO_APP_REGISTRATION_ENABLED', 'true');
    expect(await isRegistrationEnabled()).toBe(true);
  });

  it('resolves the branding slice', async () => {
    vi.stubEnv('MOJITO_APP_FAVICON', 'https://example.com/icon.png');
    await writeSettings({ 'app:gravatar': 'true' });
    const branding = await getBranding();
    expect(branding).toEqual({
      appName: SETTING_DEFAULTS['app:name'],
      favicon: 'https://example.com/icon.png',
      gravatar: true,
      registrationEnabled: true, // untouched in this test → code default
    });
  });
});

// ─── Validators ───────────────────────────────────────────────────────────────

describe('settings validators', () => {
  it('accepts a valid general payload', () => {
    const parsed = updateGeneralSettingsSchema.safeParse({
      appName: 'My Panel',
      favicon: '',
      gravatar: true,
      registrationEnabled: false,
      marketplaceSyncInterval: 360,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a bad favicon URL and a too-short app name', () => {
    const bad = updateGeneralSettingsSchema.safeParse({
      appName: 'M',
      favicon: 'ftp://example.com/icon.ico',
      gravatar: true,
      registrationEnabled: true,
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a valid mail payload and rejects a bad port', () => {
    const good = updateMailSettingsSchema.safeParse({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      username: '',
      password: '',
      encryption: 'starttls',
      fromAddress: 'panel@example.com',
      fromName: 'Mojito Panel',
    });
    expect(good.success).toBe(true);

    const badPort = updateMailSettingsSchema.safeParse({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 0,
      username: '',
      password: '',
      encryption: 'tls',
      fromAddress: '',
      fromName: 'Mojito Panel',
    });
    expect(badPort.success).toBe(false);

    const badDriver = updateMailSettingsSchema.safeParse({
      driver: 'mailgun', // not implemented in V1 — rejected by the enum
      host: 'smtp.example.com',
      port: 587,
      username: '',
      password: '',
      encryption: 'tls',
      fromAddress: '',
      fromName: 'Mojito Panel',
    });
    expect(badDriver.success).toBe(false);
  });
});
