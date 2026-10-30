import { Migration } from '@mikro-orm/migrations';

export class Migration20261013140000 extends Migration {
  override name = 'Migration20261013140000';

  override up(): void | Promise<void> {
    // Scheme used to reach the agent (Pelican "Communicate over SSL"):
    // https when the agent — or a reverse proxy in front of it — serves
    // TLS. Existing nodes keep plain HTTP.
    this.addSql(`alter table "node" add column "scheme" varchar(255) not null default 'http';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "node" drop column "scheme";`);
  }
}
