import { Migration } from '@mikro-orm/migrations';

export class Migration20261011150000 extends Migration {
  override name = 'Migration20261011150000';

  override up(): void | Promise<void> {
    // Backups (server archives created/restored by the agent, panel rows
    // are the source of truth). `server.backup_limit` caps the non-failed
    // backups a server may keep (0 = backups disabled, Pelican semantics).
    this.addSql(`alter table "server" add column "backup_limit" integer not null default 5;`);
    this.addSql(
      `create table "backup" ("id" varchar(255) not null, "server_id" text not null, "name" varchar(128) not null, "status" varchar(255) not null default 'pending', "size_bytes" integer not null default 0, "checksum" text null, "error" text null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`create index "backup_server_id_index" on "backup" ("server_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "backup" cascade;`);
    this.addSql(`alter table "server" drop column "backup_limit";`);
  }
}
