import { Migration } from '@mikro-orm/migrations';

export class Migration20261023143000 extends Migration {
  override name = 'Migration20261023143000';

  override up(): void | Promise<void> {
    // The server's recipe snapshot becomes ONE self-contained document:
    // { recipe, runtimes } — the whole resolved graph in a single column,
    // no second column that could drift out of sync with the first.
    // Existing rows (written this morning as two columns) are folded;
    // the legacy `runtime_snapshots` column is then dropped.
    this.addSql(
      `update "server" set "recipe_snapshot" = jsonb_build_object('recipe', "recipe_snapshot", 'runtimes', coalesce("runtime_snapshots", '[]'::jsonb))` +
        ` where "recipe_snapshot" is not null and not ("recipe_snapshot" ? 'runtimes');`,
    );
    this.addSql(`alter table "server" drop column "runtime_snapshots";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "server" add column "runtime_snapshots" jsonb null;`);
    this.addSql(
      `update "server" set "runtime_snapshots" = "recipe_snapshot"->'runtimes', "recipe_snapshot" = "recipe_snapshot"->'recipe'` +
        ` where "recipe_snapshot" is not null and ("recipe_snapshot" ? 'runtimes');`,
    );
  }
}
