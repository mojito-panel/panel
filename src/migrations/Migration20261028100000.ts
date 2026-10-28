import { Migration } from '@mikro-orm/migrations';

export class Migration20261028100000 extends Migration {

  override name = 'Migration20261028100000';

  override up(): void | Promise<void> {
    // Recipe provenance (marketplace + URL imports, ~/lib/recipe-source):
    // source columns are nullable — a hand-made recipe has no source.
    this.addSql(`alter table "recipe" add column "source_url" text null, add column "source_sha" text null, add column "remote_sha" text null, add column "remote_checked_at" timestamptz null;`);

    // Registries (marketplace): any public git repository of recipes. The
    // catalog of the last sync is cached on the row (jsonb, content included).
    this.addSql(`create table "recipe_registry" ("id" varchar(255) not null, "name" varchar(128) not null, "url" text not null, "branch" varchar(128) not null default '', "branch_name" varchar(128) not null default '', "entries" jsonb null, "head_sha" text null, "last_synced_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);

    // Backfill: recipes imported before provenance existed adopt their own
    // `update_url` (Pelican meta.update_url) as their direct source. The
    // import stamp (source_sha) is deliberately left null — the status
    // computation falls back to the stored content as its baseline, and the
    // first upstream check stamps it properly.
    this.addSql(`update "recipe" set "source_url" = "json"->>'update_url' where "json"->>'update_url' is not null and "json"->>'update_url' like 'https://%';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "recipe" drop column "source_url", drop column "source_sha", drop column "remote_sha", drop column "remote_checked_at";`);
    this.addSql(`drop table if exists "recipe_registry" cascade;`);
  }

}
