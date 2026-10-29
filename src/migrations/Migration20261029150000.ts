import { Migration } from '@mikro-orm/migrations';

export class Migration20261029150000 extends Migration {

  override name = 'Migration20261029150000';

  override up(): void | Promise<void> {
    // registry.json manifest metadata — stamped at every registry sync
    // (the repository is the source of truth). Description is required
    // by the manifest schema, author and license are optional.
    this.addSql(`alter table "registry" add column "description" text null;`);
    this.addSql(`alter table "registry" add column "author" varchar(256) null;`);
    this.addSql(`alter table "registry" add column "license" varchar(128) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "registry" drop column if exists "description";`);
    this.addSql(`alter table "registry" drop column if exists "author";`);
    this.addSql(`alter table "registry" drop column if exists "license";`);
  }

}
