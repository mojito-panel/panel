import { z } from 'zod';
import type { MailDriver, MailEncryption, SettingKey } from '~/lib/settings';
import { MAIL_ENCRYPTIONS, MAIL_DRIVERS } from '~/lib/settings';

/**
 * General settings — App Name, favicon, Gravatar avatars, registration.
 * Booleans are native here (storage serializes them as "true"/"false").
 */
export const updateGeneralSettingsSchema = z.object({
  appName: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  favicon: z
    .string()
    .max(2048)
    .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'Doit être une URL http(s) ou vide'),
  gravatar: z.boolean(),
  registrationEnabled: z.boolean(),
  /** Minutes between automatic marketplace update checks (0 = manual only). */
  marketplaceSyncInterval: z
    .number()
    .int('Doit être un nombre entier de minutes')
    .min(0, 'Doit être positif (0 = manuel)')
    .max(10080, 'Maximum une semaine (10080 minutes)'),
});

export type UpdateGeneralSettingsDto = z.infer<typeof updateGeneralSettingsSchema>;

/**
 * Mail settings — SMTP only in V1 (the driver enum grows when other
 * transports are added). `password` is a "keep" sentinel: empty = unchanged,
 * the stored value is never round-tripped to the client.
 */
export const updateMailSettingsSchema = z.object({
  driver: z.enum(MAIL_DRIVERS),
  host: z.string().min(1, 'L’hôte est requis').max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255),
  /** Empty = keep the current password. */
  password: z.string().max(1024),
  encryption: z.enum(MAIL_ENCRYPTIONS),
  fromAddress: z
    .string()
    .max(255)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Adresse e-mail invalide'),
  fromName: z.string().min(1, 'Le nom d’expéditeur est requis').max(128),
});

export type UpdateMailSettingsDto = z.infer<typeof updateMailSettingsSchema>;

// ─── Read payloads (getSettingsFn → settings components) ─────────────────────

/** General tab state, as returned by the settings server function. */
export interface GeneralSettingsDto {
  appName: string;
  favicon: string;
  gravatar: boolean;
  registrationEnabled: boolean;
  marketplaceSyncInterval: number;
}

/** Mail tab state — `hasPassword` replaces the stored secret (never sent). */
export interface MailSettingsDto {
  driver: MailDriver;
  host: string;
  port: number;
  username: string;
  encryption: MailEncryption;
  fromAddress: string;
  fromName: string;
  hasPassword: boolean;
}

/** Env-forced keys, mapped to the forcing variable NAME (never the value). */
export type ForcedSettings = Partial<Record<SettingKey, string>>;
