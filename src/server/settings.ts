import '@tanstack/react-start/server-only';
import { Setting } from '~/db/entities';
import {
  SETTING_DEFAULTS,
  SETTING_KEY_LIST,
  SETTING_SECRETS,
  parseSettingBool,
  settingEnvName,
  type BrandingSettings,
  type SettingKey,
} from '~/lib/settings';

import { decryptSecret, encryptSecret } from './crypto';
import { orm } from './orm';

/**
 * Settings resolution service (server-only — like session.ts, a plain module
 * next to the server functions so its imports stay pruned from the client
 * bundle).
 *
 * Precedence: env var (forced) > `setting` row > code default — the same
 * layering as Pelican's environment overrides. Secret keys
 * (`SETTING_SECRETS`) are encrypted at rest here, so callers only ever see
 * usable values.
 */

/** Effective settings of the whole catalog, plus which keys are env-forced. */
export interface SettingsBundle {
  /** Effective value of every catalog key (env > DB > default). */
  values: Record<SettingKey, string>;
  /** Env-forced keys, mapped to the forcing variable NAME (never the value). */
  forced: Partial<Record<SettingKey, string>>;
}

/**
 * Env var forcing a key, or null. An empty env var is ignored (unset
 * semantics), so a forced setting always has a value.
 */
export function envForcedKey(key: SettingKey): string | null {
  const name = settingEnvName(key);
  const value = process.env[name];
  return value !== undefined && value !== '' ? name : null;
}

/** Reads one setting row from the DB (raw stored value, null when absent). */
async function readStored(key: SettingKey): Promise<string | null> {
  const row = await orm.em.findOne(Setting, { key });
  return row?.value ?? null;
}

/**
 * Decrypts a secret setting. A value that fails to decrypt (e.g. rotated
 * BETTER_AUTH_SECRET) degrades to empty — the admin re-enters it.
 */
function readSecret(value: string): string {
  if (value === '') return '';
  try {
    return decryptSecret(value);
  } catch {
    return '';
  }
}

/** Effective value of one setting: env var > DB row > code default. */
export async function getSettingValue(key: SettingKey): Promise<string> {
  const forced = envForcedKey(key);
  if (forced) return process.env[forced] as string;
  const stored = await readStored(key);
  if (stored === null) return SETTING_DEFAULTS[key];
  return SETTING_SECRETS.has(key) ? readSecret(stored) : stored;
}

/**
 * Resolves every catalog key in ONE query. Unknown rows in the table are
 * ignored — the catalog is the authority (a stale row never crashes the UI).
 */
export async function resolveSettings(): Promise<SettingsBundle> {
  const rows = await orm.em.find(Setting, {});
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const values = {} as Record<SettingKey, string>;
  const forced: Partial<Record<SettingKey, string>> = {};
  for (const key of SETTING_KEY_LIST) {
    const env = envForcedKey(key);
    if (env) {
      values[key] = process.env[env] as string;
      forced[key] = env;
    } else {
      const raw = stored.get(key) ?? SETTING_DEFAULTS[key];
      values[key] = SETTING_SECRETS.has(key) ? readSecret(raw) : raw;
    }
  }
  return { values, forced };
}

/**
 * Upserts setting rows. Env-forced keys are skipped (their DB value is
 * ignored anyway — the caller reports them if relevant). Secret values are
 * encrypted at rest.
 */
export async function writeSettings(
  entries: Partial<Record<SettingKey, string>>,
): Promise<SettingKey[]> {
  const em = orm.em;
  const written: SettingKey[] = [];
  for (const key of Object.keys(entries) as SettingKey[]) {
    if (envForcedKey(key)) continue;
    const value = entries[key] as string;
    const stored = SETTING_SECRETS.has(key) && value !== '' ? encryptSecret(value) : value;
    const existing = await em.findOne(Setting, { key });
    if (existing) {
      existing.value = stored;
    } else {
      em.persist(em.create(Setting, { key, value: stored }));
    }
    written.push(key);
  }
  await em.flush();
  return written;
}

// ─── Semantics helpers ───────────────────────────────────────────────────────

/** Whether public self-registration (/register) is open. */
export async function isRegistrationEnabled(): Promise<boolean> {
  return parseSettingBool(await getSettingValue('app:registration_enabled'));
}

/** Branding slice of the settings (title/favicon of the document, avatars). */
export async function getBranding(): Promise<BrandingSettings> {
  const { values } = await resolveSettings();
  return {
    appName: values['app:name'],
    favicon: values['app:favicon'],
    gravatar: parseSettingBool(values['app:gravatar']),
    registrationEnabled: parseSettingBool(values['app:registration_enabled']),
  };
}
