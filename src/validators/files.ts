import { z } from 'zod';

/**
 * File browser schemas.
 * - `*Schema` (query/body) : server function validators
 * - `*FormSchema`          : TanStack Form validators (no coerce/default per convention)
 *
 * All paths are RELATIVE to the server root, POSIX-style — the agent
 * re-validates them (traversal gate) via resolveServerPath.
 */

/** Query/body: a relative path (may be empty = server root). */
export const filesQuerySchema = z.object({
  serverId: z.string().min(1),
  path: z.string().max(1024).default(''),
});

export type FilesQueryDto = z.output<typeof filesQuerySchema>;

/** Query/body: a non-empty relative path (read/write/rename targets). */
export const filePathQuerySchema = z.object({
  serverId: z.string().min(1),
  path: z.string().min(1).max(1024),
});

export type FilePathQueryDto = z.infer<typeof filePathQuerySchema>;

/** Body: save the editor content. */
export const saveFileSchema = z.object({
  serverId: z.string().min(1),
  path: z.string().min(1).max(1024),
  content: z.string().max(2 * 1024 * 1024), // 1 MB of UTF-8 text (base64/multi-byte headroom)
});

export type SaveFileDto = z.infer<typeof saveFileSchema>;

/** Body: create a file/folder — name resolved against the current directory. */
export const createEntrySchema = z.object({
  serverId: z.string().min(1),
  directory: z.string().max(1024).default(''),
  name: z.string().min(1, 'Le nom est requis').max(255),
  type: z.enum(['file', 'directory']),
});

export type CreateEntryDto = z.output<typeof createEntrySchema>;

/** Body: rename an entry — only the NEW name, resolved next to the old path. */
export const renameEntrySchema = z.object({
  serverId: z.string().min(1),
  path: z.string().min(1).max(1024),
  newName: z.string().min(1, 'Le nouveau nom est requis').max(255),
});

export type RenameEntryDto = z.infer<typeof renameEntrySchema>;

/** Body: delete entries (relative paths). */
export const deleteEntriesSchema = z.object({
  serverId: z.string().min(1),
  paths: z.array(z.string().min(1).max(1024)).min(1).max(100),
});

export type DeleteEntriesDto = z.infer<typeof deleteEntriesSchema>;

/** Body: upload a file — base64 of the raw bytes (read in the browser). */
export const uploadFileSchema = z.object({
  serverId: z.string().min(1),
  directory: z.string().max(1024).default(''),
  filename: z.string().min(1).max(255),
  contentBase64: z
    .string()
    .min(1)
    .max(16 * 1024 * 1024), // ~10 MB decoded
});

export type UploadFileDto = z.output<typeof uploadFileSchema>;

// ─── Download link (short-lived JWT, browser → agent) ───────────────────────

/** Requests a signed download link for one file (relative path). */
export const fileDownloadSchema = z.object({
  serverId: z.string().min(1),
  path: z.string().min(1).max(1024),
});

export type FileDownloadDto = z.output<typeof fileDownloadSchema>;

// ─── URL search params (?dir=...&file=... deep-linking) ────────────────────

export const filesSearchSchema = z.object({
  dir: z.string().max(1024).default(''),
  /** Set → the editor is open on this file (relative path). */
  file: z.string().min(1).max(1024).optional(),
});

export type FilesSearch = z.output<typeof filesSearchSchema>;

// ─── Form validators (TanStack Form — no z.coerce / z.default here) ─────────

/** A single entry name (no path separators, no traversal, Windows-safe). */
const entryNameField = z
  .string()
  .min(1, 'Le nom est requis')
  .max(255)
  .regex(/^[^<>:"|?*\\/]+$/, 'Caractères interdits (<>:"|?*\\ /)')
  .refine((v) => v !== '.' && v !== '..', {
    message: 'Nom de dossier invalide',
  });

/** Create form: name + type. */
export const createEntryFormSchema = z.object({
  name: entryNameField,
  type: z.enum(['file', 'directory']),
});

export type CreateEntryFormDto = z.infer<typeof createEntryFormSchema>;

/** Rename form: the new name only. */
export const renameEntryFormSchema = z.object({
  name: entryNameField,
});

/** Editor form: raw text content. */
export const saveFileFormSchema = z.object({
  content: z.string().max(2 * 1024 * 1024, 'Fichier trop volumineux'),
});

export type SaveFileFormDto = z.infer<typeof saveFileFormSchema>;
