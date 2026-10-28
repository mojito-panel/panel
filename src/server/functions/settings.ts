import { createServerFn } from '@tanstack/react-start';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import {
  SETTING_KEYS,
  formatSettingBool,
  parseSettingBool,
  type BrandingSettings,
  type MailDriver,
  type MailEncryption,
  type SettingKey,
} from '~/lib/settings';
import { requirePanelPermission, HttpError } from '../session';
import {
  resolveSettings,
  getBranding,
  writeSettings,
  envForcedKey,
} from '../settings';
import {
  updateGeneralSettingsSchema,
  updateMailSettingsSchema,
  type ForcedSettings,
  type GeneralSettingsDto,
  type MailSettingsDto,
} from '~/validators/settings';

/**
 * Panel settings — Pelican "Settings" admin area: general (branding +
 * registration) and mail (SMTP). Values resolve env var > DB > default
 * (see ~/server/settings); env-forced keys are returned in `forced` so the
 * UI locks the corresponding fields.
 */

/** Refuses to update keys that an env var forces (422 with the variable name). */
function assertNotForced(keys: SettingKey[]): void {
  for (const key of keys) {
    const env = envForcedKey(key);
    if (env) {
      throw new HttpError(422, `Le paramètre « ${key} » est forcé par la variable d’environnement ${env}`);
    }
  }
}

// ─── Branding (public) ────────────────────────────────────────────────────────

/**
 * Branding slice — app name/favicon, Gravatar and registration state.
 * Unauthenticated on purpose: the document title, the login page and the
 * register page need it before any session exists, and whether sign-up is
 * open is public by nature.
 */
export const getBrandingFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(
  async (): Promise<BrandingSettings> => {
    return getBranding(orm.em);
  },
);

// ─── Admin read ───────────────────────────────────────────────────────────────

/** Full settings of both tabs + the env-forced key map (for field locking). */
export const getSettingsFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(
  async (): Promise<{
    general: GeneralSettingsDto;
    mail: MailSettingsDto;
    forced: ForcedSettings;
  }> => {
    await requirePanelPermission({ 'panel.settings': ['read'] });
    const { values, forced } = await resolveSettings(orm.em);

    return {
      general: {
        appName: values['app:name'],
        favicon: values['app:favicon'],
        gravatar: parseSettingBool(values['app:gravatar']),
        registrationEnabled: parseSettingBool(values['app:registration_enabled']),
        marketplaceSyncInterval: Number(values['marketplace:sync_interval']),
      },
      mail: {
        // Casts: the write path only stores valid values (validated enums)
        driver: values['mail:driver'] as MailDriver,
        host: values['mail:smtp:host'],
        port: Number(values['mail:smtp:port']),
        username: values['mail:smtp:username'],
        encryption: values['mail:smtp:encryption'] as MailEncryption,
        fromAddress: values['mail:from:address'],
        fromName: values['mail:from:name'],
        // The stored password is never sent back — only whether one exists.
        hasPassword: values['mail:smtp:password'] !== '',
      },
      forced,
    };
  },
);

// ─── Admin updates ────────────────────────────────────────────────────────────

export const updateGeneralSettingsFn = createServerFn({ method: 'POST' })
  .validator(updateGeneralSettingsSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.settings': ['update'] });
    const keys: SettingKey[] = [
      SETTING_KEYS.appName,
      SETTING_KEYS.appFavicon,
      SETTING_KEYS.appGravatar,
      SETTING_KEYS.appRegistrationEnabled,
      SETTING_KEYS.marketplaceSyncInterval,
    ];
    assertNotForced(keys);

    await writeSettings(orm.em, {
      'app:name': data.appName,
      'app:favicon': data.favicon,
      'app:gravatar': formatSettingBool(data.gravatar),
      'app:registration_enabled': formatSettingBool(data.registrationEnabled),
      'marketplace:sync_interval': String(data.marketplaceSyncInterval),
    });

    return { updated: true };
  });

export const updateMailSettingsFn = createServerFn({ method: 'POST' })
  .validator(updateMailSettingsSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.settings': ['update'] });
    const keys: SettingKey[] = [
      SETTING_KEYS.mailDriver,
      SETTING_KEYS.mailHost,
      SETTING_KEYS.mailPort,
      SETTING_KEYS.mailUsername,
      SETTING_KEYS.mailEncryption,
      SETTING_KEYS.mailFromAddress,
      SETTING_KEYS.mailFromName,
    ];
    // The password is only written when a NEW value is submitted (empty = keep)
    if (data.password !== '') keys.push(SETTING_KEYS.mailPassword);
    assertNotForced(keys);

    await writeSettings(orm.em, {
      'mail:driver': data.driver,
      'mail:smtp:host': data.host,
      'mail:smtp:port': String(data.port),
      'mail:smtp:username': data.username,
      'mail:smtp:encryption': data.encryption,
      'mail:from:address': data.fromAddress,
      'mail:from:name': data.fromName,
      ...(data.password !== ''
        ? { 'mail:smtp:password': data.password }
        : {}),
    });

    return { updated: true };
  });
