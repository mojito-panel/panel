/**
 * Panel settings catalog — PURE TypeScript, shared by client and server
 * (safe to import anywhere).
 *
 * Pelican-style design: settings live in the `setting` table as one row per
 * namespaced key ("app:name", "mail:smtp:host", …). Defaults live in code —
 * DB rows are overrides only, so new keys added here work with zero
 * migration/seeding.
 *
 * Precedence (same layering as Pelican's environment overrides):
 *
 *   1. Environment variable (FORCED — wins over everything, the admin UI
 *      locks the field): `MOJITO_` + key upper-cased, ":" → "_"
 *      ("app:name" → MOJITO_APP_NAME, "mail:smtp:host" → MOJITO_MAIL_SMTP_HOST).
 *   2. `setting` table row.
 *   3. `SETTING_DEFAULTS`.
 */

// ─── Keys (the wire + storage format) ─────────────────────────────────────────

/** Namespaced setting keys stored in the `setting` table. */
export const SETTING_KEYS = {
  appName: 'app:name',
  appFavicon: 'app:favicon',
  appGravatar: 'app:gravatar',
  appRegistrationEnabled: 'app:registration_enabled',
  mailDriver: 'mail:driver',
  mailHost: 'mail:smtp:host',
  mailPort: 'mail:smtp:port',
  mailUsername: 'mail:smtp:username',
  mailPassword: 'mail:smtp:password',
  mailEncryption: 'mail:smtp:encryption',
  mailFromAddress: 'mail:from:address',
  mailFromName: 'mail:from:name',
} as const;

export type SettingName = keyof typeof SETTING_KEYS;
export type SettingKey = (typeof SETTING_KEYS)[SettingName];

/** All catalog keys, as a plain list (iteration order for resolution). */
export const SETTING_KEY_LIST = Object.values(SETTING_KEYS) as SettingKey[];

/** True when `key` is part of the catalog. */
export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEY_LIST as string[]).includes(key);
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Code defaults — a DB row overrides, an env var forces. */
export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  'app:name': 'Mojito Panel',
  // '' = no custom favicon (the browser default applies)
  'app:favicon': '',
  'app:gravatar': 'false',
  'app:registration_enabled': 'true',
  // Only SMTP is implemented in V1 — the driver key exists so other
  // transports (mailgun, sendgrid…) slot in later without a schema change.
  'mail:driver': 'smtp',
  'mail:smtp:host': 'localhost',
  'mail:smtp:port': '587',
  'mail:smtp:username': '',
  'mail:smtp:password': '',
  // tls | starttls | none
  'mail:smtp:encryption': 'tls',
  'mail:from:address': '',
  'mail:from:name': 'Mojito Panel',
};

/** Secrets stored encrypted at rest and never round-tripped to the client. */
export const SETTING_SECRETS: ReadonlySet<SettingKey> = new Set([
  SETTING_KEYS.mailPassword,
]);

// ─── Mail values ─────────────────────────────────────────────────────────────

/** SMTP connection security of the panel's own mailer. */
export const MAIL_ENCRYPTIONS = ['tls', 'starttls', 'none'] as const;
export type MailEncryption = (typeof MAIL_ENCRYPTIONS)[number];

/** Mail drivers the panel knows how to USE (the setting accepts one of these). */
export const MAIL_DRIVERS = ['smtp'] as const;
export type MailDriver = (typeof MAIL_DRIVERS)[number];

// ─── Env override mapping ────────────────────────────────────────────────────

/**
 * Environment variable name that forces a setting:
 * MOJITO_ + key upper-cased with ":" → "_".
 * Example: "app:name" → MOJITO_APP_NAME, "mail:smtp:host" → MOJITO_MAIL_SMTP_HOST.
 */
export function settingEnvName(key: SettingKey): string {
  return `MOJITO_${key.replace(/:/g, '_').toUpperCase()}`;
}

// ─── Boolean serialization (values are stored as text) ───────────────────────

/** Parses a stored boolean setting ("true"/"false", default false). */
export function parseSettingBool(value: string): boolean {
  return value === 'true';
}

/** Formats a boolean for storage. */
export function formatSettingBool(value: boolean): string {
  return value ? 'true' : 'false';
}

// ─── Branding DTO (public settings consumed by the UI everywhere) ───────────

/**
 * Branding slice of the settings — resolved server-side and consumed by the
 * root document (title/favicon), the auth pages and the sidebars. Registration
 * state is included: the register page needs it before any user exists, and
 * whether sign-up is open is public by nature.
 */
export interface BrandingSettings {
  appName: string;
  /** http(s) URL of the favicon — '' = browser default. */
  favicon: string;
  /** Use Gravatar avatars (hashed e-mail) instead of initials. */
  gravatar: boolean;
  /** Whether public self-registration (/register) is open. */
  registrationEnabled: boolean;
}
