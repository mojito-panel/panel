import { Migration } from '@mikro-orm/migrations';

export class Migration20261011170000 extends Migration {

  override name = 'Migration20261011170000';

  override up(): void | Promise<void> {
    // SFTP (wings parity): per-node SFTP listen port of the agent —
    // written into the generated shard.yml and shown on server pages.
    this.addSql(`alter table "node" add column "sftp_port" integer not null default 2022;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "node" drop column "sftp_port";`);
  }

}
