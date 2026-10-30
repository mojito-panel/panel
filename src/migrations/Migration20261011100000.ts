import { Migration } from '@mikro-orm/migrations';

export class Migration20261011100000 extends Migration {
  override name = 'Migration20261011100000';

  override up(): void | Promise<void> {
    // better-auth admin plugin columns — added by hand here (better-auth
    // never generates migrations in this project, MikroORM owns the schema)
    this.addSql(`alter table "user" add column "banned" boolean not null default false;`);
    this.addSql(`alter table "user" add column "ban_reason" varchar(255) null;`);
    this.addSql(`alter table "user" add column "ban_expires" timestamptz null;`);
    this.addSql(`alter table "session" add column "impersonated_by" varchar(255) null;`);

    // Pelican-style sub-users: per-server permission grant
    this.addSql(
      `create table "server_user" ("id" varchar(255) not null, "server_id" varchar(255) not null, "user_id" varchar(255) not null, "permissions" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "server_user" add constraint "server_user_server_id_user_id_unique" unique ("server_id", "user_id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "server_user" cascade;`);
    this.addSql(`alter table "session" drop column "impersonated_by";`);
    this.addSql(`alter table "user" drop column "ban_expires";`);
    this.addSql(`alter table "user" drop column "ban_reason";`);
    this.addSql(`alter table "user" drop column "banned";`);
  }
}
