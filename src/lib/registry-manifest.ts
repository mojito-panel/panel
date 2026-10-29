import { z } from 'zod';

/**
 * registry.json — the manifest a recipe registry MUST ship at its
 * repository root. Two roles:
 *
 * - the MARKER: its presence (and validity) is what makes a git repository
 *   a registry. A wrong URL or a random project fails the sync with a
 *   readable error instead of silently syncing an empty catalog;
 * - the METADATA: description (required), author and license (optional,
 *   displayed when present), and an optional cover path that overrides
 *   the repo-root `cover.*` convention.
 */

/** File name of the manifest at the repository root. */
export const REGISTRY_MANIFEST_FILE = 'registry.json';

/** Supported cover extensions (the mime of the cached data URL). */
const COVER_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

/**
 * A cover path must stay a plain repo-relative path: the clone reads it
 * with join(root, path), so `..` segments, absolute paths and drive
 * letters must never reach it (same safety rule as the backup include
 * patterns).
 */
const RELATIVE_COVER_PATH = /^(?!\/)(?!\\)(?!.*:)[^<>:"|?*]+$/;

export const registryManifestSchema = z.object({
  /** What this registry provides — shown on the marketplace card. */
  description: z.string().min(1).max(2_000),
  /** Who maintains the registry — optional, shown when present. */
  author: z.string().min(1).max(256).optional(),
  /** License of the recipes (SPDX id or free text) — optional, shown when present. */
  license: z.string().min(1).max(128).optional(),
  /**
   * Cover artwork of the repository — a repo-relative path ending in
   * png/jpg/jpeg/webp. Overrides the repo-root `cover.*` convention;
   * absent or unreadable = the convention (or the generated gradient).
   */
  cover: z
    .string()
    .min(1)
    .max(512)
    .refine((path) => COVER_EXTENSIONS.test(path), {
      message: 'must end in .png, .jpg, .jpeg or .webp',
    })
    .refine((path) => !path.split(/[/\\]/).includes('..') && RELATIVE_COVER_PATH.test(path), {
      message: 'must be a plain repository-relative path',
    })
    .optional(),
});

export type RegistryManifest = z.infer<typeof registryManifestSchema>;

/**
 * Parses the raw root registry.json. Throws a single readable Error —
 * the registry sync surfaces it as `lastError` on the row.
 */
export function parseRegistryManifest(raw: string): RegistryManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('registry.json is not valid JSON');
  }
  const result = registryManifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? `field "${issue.path.join('.')}"` : 'the manifest';
    throw new Error(`invalid registry.json: ${field} ${issue.message}`);
  }
  return result.data;
}

/**
 * Cover path declared by the manifest, WITHOUT schema validation — a peek
 * used during the clone to read the artwork while the temp dir still
 * exists (the full validation happens in parseRegistryManifest, at the
 * sync layer). Null when the manifest is absent, unparsable or declares
 * no cover.
 */
export function manifestCoverPath(raw: string | null): string | null {
  if (raw == null) return null;
  try {
    const value = (JSON.parse(raw) as { cover?: unknown })?.cover;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
