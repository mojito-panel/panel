import { Migration } from '@mikro-orm/migrations';

export class Migration20261011090000 extends Migration {

  override name = 'Migration20261011090000';

  override up(): void | Promise<void> {
    // The memory limit moves from the allocation to the server itself
    // (Pelican semantics: allocation = IP:port, limits live on the server)
    this.addSql(`alter table "server" add column "memory_mb" int not null default 2048;`);
    this.addSql(`update "server" as s set "memory_mb" = a."max_ram_mb" from "server_allocation" as a where a."server_id" = s."id";`);

    // Pelican-style allocation: an IP:port pooled per node, optionally
    // assigned to a server (null = free), one primary per server
    this.addSql(`create table "allocation" ("id" varchar(255) not null, "node_id" varchar(255) not null, "server_id" varchar(255) null, "ip" varchar(255) not null default '0.0.0.0', "port" int not null, "alias" varchar(255) null, "is_primary" boolean not null default false, "created_at" timestamptz not null, primary key ("id"));`);

    // Existing ports become the servers' primary allocations
    this.addSql(`insert into "allocation" ("id", "node_id", "server_id", "ip", "port", "alias", "is_primary", "created_at") select a."id", s."node_id", a."server_id", '0.0.0.0', a."port", null, true, a."created_at" from "server_allocation" as a join "server" as s on s."id" = a."server_id";`);

    this.addSql(`drop table if exists "server_allocation" cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`create table "server_allocation" ("id" varchar(255) not null, "server_id" varchar(255) not null, "port" int not null, "max_ram_mb" int not null, "max_cpu_percent" int not null default 100, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`insert into "server_allocation" ("id", "server_id", "port", "max_ram_mb", "max_cpu_percent", "created_at") select "id", "server_id", "port", 2048, 100, "created_at" from "allocation" where "server_id" is not null;`);
    this.addSql(`drop table if exists "allocation" cascade;`);
    this.addSql(`alter table "server" drop column "memory_mb";`);
  }

}
