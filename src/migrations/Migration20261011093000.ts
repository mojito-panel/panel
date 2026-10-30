import { Migration } from '@mikro-orm/migrations';

export class Migration20261011093000 extends Migration {
  override name = 'Migration20261011093000';

  override up(): void | Promise<void> {
    // Domain rename: "plugin" → "recipe" (Pelican egg equivalent)
    this.addSql(`alter table "plugin" rename to "recipe";`);
    this.addSql(
      `alter table "recipe" rename constraint "plugin_slug_unique" to "recipe_slug_unique";`,
    );
    this.addSql(`alter table "server" rename column "plugin_id" to "recipe_id";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "server" rename column "recipe_id" to "plugin_id";`);
    this.addSql(
      `alter table "recipe" rename constraint "recipe_slug_unique" to "plugin_slug_unique";`,
    );
    this.addSql(`alter table "recipe" rename to "plugin";`);
  }
}
