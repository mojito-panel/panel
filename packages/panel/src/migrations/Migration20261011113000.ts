import { Migration } from '@mikro-orm/migrations';

export class Migration20261011113000 extends Migration {

  override name = 'Migration20261011113000';

  override up(): void | Promise<void> {
    // Custom panel roles (Pelican-style, managed from /admin/roles).
    // The `id` is the value stored in user.role; built-in roles
    // (admin/moderator/user) stay code-defined and never appear here.
    this.addSql(`create table "role" ("id" varchar(255) not null, "name" varchar(128) not null, "description" text null, "permissions" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "role" add constraint "role_name_unique" unique ("name");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "role" cascade;`);
  }

}
