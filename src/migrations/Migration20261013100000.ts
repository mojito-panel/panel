import { Migration } from '@mikro-orm/migrations';

export class Migration20261013100000 extends Migration {

  override name = 'Migration20261013100000';

  override up(): void | Promise<void> {
    // Panel settings — Pelican-style key/value store. Defaults live in code
    // (SETTING_DEFAULTS in ~/lib/settings): rows are overrides only.
    this.addSql(`create table "setting" ("key" varchar(128) not null, "value" text not null, constraint "setting_pkey" primary key ("key"));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table "setting";`);
  }

}
