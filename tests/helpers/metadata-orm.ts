/**
 * `connect: false` is runtime-valid but absent from the MikroORM v7 option
 * types (metadata-only init). Spread from a VARIABLE — spread properties
 * skip the object literal's excess-property check, so the cast stays on
 * that single option instead of the whole config.
 *
 * Shared by the Postgres suites (probe + metadata-only ORM init).
 */
export const metadataOnly = { connect: false } as const;
