import { Migration } from '@mikro-orm/migrations';

export class Migration20261023100000 extends Migration {

  override name = 'Migration20261023100000';

  override up(): void | Promise<void> {
    // Servers become self-contained: they carry a SNAPSHOT of their recipe
    // (app recipe + resolved runtimes + merged variable definitions) taken
    // at install time. A recipe edited later never touches a live server
    // until an explicit "reload recipe" re-snapshots it.
    // Existing rows are left NULL — the first read backfills the snapshot
    // from the current recipe (the best guess for a pre-snapshot server).
    this.addSql(`alter table "server" add column "recipe_snapshot" jsonb null;`);
    this.addSql(`alter table "server" add column "runtime_snapshots" jsonb null;`);
    this.addSql(`alter table "server" add column "recipe_synced_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "server" drop column "recipe_snapshot";`);
    this.addSql(`alter table "server" drop column "runtime_snapshots";`);
    this.addSql(`alter table "server" drop column "recipe_synced_at";`);
  }

}
