import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { initOrm } from '~/db';
import { isSecretInsecure } from '~/server/crypto';

/**
 * Custom server entrypoint — TanStack Start detects src/server.ts automatically.
 * At startup: secret sanity check, then Postgres connection + MikroORM
 * migrations (ALL tables, including the better-auth ones — the better-auth
 * CLI never runs here).
 */

// Fail fast on an insecure BETTER_AUTH_SECRET: it is BOTH the better-auth
// signing secret and the at-rest AES key (agent tokens, mail passwords).
// A production panel with the shipped placeholder must refuse to boot; a
// dev setup (where .env is often the copied .env.default) only warns.
if (isSecretInsecure(process.env.BETTER_AUTH_SECRET)) {
  const hint =
    'generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `BETTER_AUTH_SECRET is missing, too short, or the shipped placeholder — ${hint}`,
    );
  }
  console.warn(
    `[bootstrap] WARNING: BETTER_AUTH_SECRET is missing, too short, or the shipped placeholder — ${hint}`,
  );
}

const orm = await initOrm();
await orm.migrator.up();
console.log('[bootstrap] MikroORM migrations OK');

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
