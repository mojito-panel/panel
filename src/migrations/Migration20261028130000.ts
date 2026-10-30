import { Migration } from '@mikro-orm/migrations';

export class Migration20261028130000 extends Migration {
  override name = 'Migration20261028130000';

  override up(): void | Promise<void> {
    // RecipeRegistry -> Registry: the marketplace registry keeps its rows,
    // only the table is renamed. A repo-root cover (cover.png|jpg|jpeg|webp,
    // cached as a data URL by the sync) joins the row.
    this.addSql(`alter table "recipe_registry" rename to "registry";`);
    this.addSql(`alter table "registry" add column "cover" text null;`);

    // The catalog cache moves from a giant JSONB column to its own table —
    // one row per recipe file, so lists can select light columns (path/sha)
    // and never drag every cached file content around.
    this.addSql(
      `create table "registry_entry" ("id" varchar(255) not null, "registry_id" varchar(255) not null, "path" varchar(512) not null, "sha" text not null, "slug" text null, "name" text null, "type" varchar(255) null, "description" text null, "error" text null, "cover" text null, "content" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "registry_entry_registry_id_index" on "registry_entry" ("registry_id");`,
    );
    this.addSql(
      `alter table "registry_entry" add constraint "registry_entry_registry_path_unique" unique ("registry_id", "path");`,
    );

    // Data migration: explode the cached JSONB arrays into rows. The id is a
    // deterministic md5 (unique per registry+path) — a migrated entry keeps a
    // stable id without needing the nanoid generator in SQL.
    this
      .addSql(`insert into "registry_entry" ("id", "registry_id", "path", "sha", "slug", "name", "type", "description", "error", "cover", "content", "created_at", "updated_at")
select md5(r."id" || ':' || (e->>'path')), r."id", e->>'path', e->>'sha', e->>'slug', e->>'name', e->>'type', e->>'description', e->>'error', e->>'cover', e->>'content', now(), now()
from "registry" r cross join lateral jsonb_array_elements(r."entries") as e
where r."entries" is not null;`);

    this.addSql(`alter table "registry" drop column "entries";`);
  }

  override down(): void | Promise<void> {
    // Best-effort reverse: the entry rows are folded back into the JSONB
    // cache (grouped per registry), the cover is dropped, the table renamed.
    this.addSql(`alter table "registry" add column "entries" jsonb null;`);
    this.addSql(`update "registry" r set "entries" = sub.entries from (
  select r2."id" as rid, coalesce(jsonb_agg(jsonb_build_object(
    'path', e."path", 'sha', e."sha", 'slug', e."slug", 'name', e."name",
    'type', e."type", 'description', e."description", 'error', e."error",
    'cover', e."cover", 'content', e."content"), order by e."path")) as entries
  from "registry" r2 join "registry_entry" e on e."registry_id" = r2."id"
  group by r2."id"
) sub where r."id" = sub."id";`);
    this.addSql(`drop table if exists "registry_entry" cascade;`);
    this.addSql(`alter table "registry" drop column "cover";`);
    this.addSql(`alter table "registry" rename to "recipe_registry";`);
  }
}
