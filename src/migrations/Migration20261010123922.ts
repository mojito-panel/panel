import { Migration } from '@mikro-orm/migrations';

export class Migration20261010123922 extends Migration {
  override name = 'Migration20261010123922';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "account" ("id" text not null, "account_id" text not null, "provider_id" text not null, "user_id" text not null, "access_token" text null, "refresh_token" text null, "id_token" text null, "access_token_expires_at" timestamptz null, "refresh_token_expires_at" timestamptz null, "scope" text null, "password" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "node" ("id" varchar(255) not null, "name" varchar(128) not null, "fqdn" varchar(255) not null, "agent_port" int not null default 8080, "agent_token" text not null, "last_seen_at" timestamptz null, "status" varchar(255) not null default 'unknown', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "plugin" ("id" varchar(255) not null, "slug" varchar(128) not null, "name" varchar(128) not null, "schema_version" int not null default 1, "json" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`alter table "plugin" add constraint "plugin_slug_unique" unique ("slug");`);

    this.addSql(
      `create table "server" ("id" varchar(255) not null, "name" varchar(128) not null, "node_id" varchar(255) not null, "plugin_id" varchar(255) not null, "owner_id" varchar(255) not null, "status" varchar(255) not null default 'stopped', "variables" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "server_allocation" ("id" varchar(255) not null, "server_id" varchar(255) not null, "port" int not null, "max_ram_mb" int not null, "max_cpu_percent" int not null default 100, "created_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "session" ("id" text not null, "expires_at" timestamptz not null, "token" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "ip_address" varchar(255) null, "user_agent" varchar(255) null, "user_id" text not null, primary key ("id"));`,
    );
    this.addSql(`alter table "session" add constraint "session_token_unique" unique ("token");`);

    this.addSql(
      `create table "user" ("id" text not null, "name" varchar(128) not null, "email" text not null, "email_verified" boolean not null default false, "image" text null, "role" varchar(255) not null default 'user', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`alter table "user" add constraint "user_email_unique" unique ("email");`);

    this.addSql(
      `create table "verification" ("id" varchar(255) not null, "identifier" varchar(255) not null, "value" varchar(255) not null, "expires_at" timestamptz not null, "created_at" timestamptz null, "updated_at" timestamptz null, primary key ("id"));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "account" cascade;`);
    this.addSql(`drop table if exists "node" cascade;`);
    this.addSql(`drop table if exists "plugin" cascade;`);
    this.addSql(`drop table if exists "server" cascade;`);
    this.addSql(`drop table if exists "server_allocation" cascade;`);
    this.addSql(`drop table if exists "session" cascade;`);
    this.addSql(`drop table if exists "user" cascade;`);
    this.addSql(`drop table if exists "verification" cascade;`);
  }
}
