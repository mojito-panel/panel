import { Migration } from '@mikro-orm/migrations';

export class Migration20261014090000 extends Migration {

  override name = 'Migration20261014090000';

  override up(): void | Promise<void> {
    // Admin suspension of a server (Pelican semantics — suspended servers
    // are stopped, cannot be started and hidden from their owner/sub-users).
    this.addSql(`alter table "server" add column "suspended" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "server" drop column "suspended";`);
  }

}
