import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

import { initOrm } from '~/db';
import { isSecretInsecure } from '~/server/crypto';
import { startQueue } from '~/server/queue';
import { startMarketplaceRunner } from '~/server/registries';
import { startScheduleRunner } from '~/server/schedules';

/**
 * Custom server entrypoint — TanStack Start detects src/server.ts automatically.
 * At startup: secret sanity check, then Postgres connection + MikroORM
 * migrations (ALL tables, including the better-auth ones — the better-auth
 * CLI never runs here), then the pg-boss queue and the schedule runner.
 */

// Fail fast on an insecure BETTER_AUTH_SECRET: it is BOTH the better-auth
// signing secret and the at-rest AES key (agent tokens, mail passwords).
// A production panel with the shipped placeholder must refuse to boot; a
// dev setup (where .env is often the copied .env.default) only warns.
if (isSecretInsecure(process.env.BETTER_AUTH_SECRET)) {
  const hint =
    "generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
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

// pg-boss installs/updates its OWN schema (never managed by MikroORM) and
// starts its maintenance passes; the schedule runner then registers the
// task worker + its tick interval (boot sweep included).
await startQueue();
startScheduleRunner();
startMarketplaceRunner();

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
