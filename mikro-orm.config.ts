import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Registry,
  RegistryEntry,
  SshKey,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
  Backup,
  Setting,
  ActivityLog,
  Schedule,
  ScheduleTask,
} from './src/db/entities';

/**
 * CLI-only configuration (`npm run db:migrate` / `db:migrate:up` — the
 * `mikro-orm` binary). Deliberately does NOT import `src/db/index.ts`:
 * the RUNTIME config bundles the migrations through Vite's
 * `import.meta.glob`, a compile-time macro no standalone TS loader
 * (jiti, oxc, tsx, swc…) provides — the CLI would crash on it. Here the
 * CLI resolves the migration files itself from `migrations.path` (it
 * registers its own TS loader first). The entities are the same module
 * the runtime uses, so the CLI diff and the app can never drift.
 */
export default defineConfig({
  dbName: 'mojito',
  clientUrl: process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito',
  entities: [
    User,
    Session,
    Account,
    Verification,
    Node,
    Recipe,
    Registry,
    RegistryEntry,
    SshKey,
    Server,
    Allocation,
    ServerUser,
    PanelRole,
    Backup,
    Setting,
    ActivityLog,
    Schedule,
    ScheduleTask,
  ],
  extensions: [Migrator],
  migrations: {
    path: 'src/migrations',
    glob: 'Migration*.ts',
    snapshot: false,
    tableName: 'mikro_orm_migrations',
  },
});
