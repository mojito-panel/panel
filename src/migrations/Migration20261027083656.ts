import { Migration } from '@mikro-orm/migrations';

export class Migration20261027083656 extends Migration {
  override name = 'Migration20261027083656';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "schedule" ("id" varchar(255) not null, "server_id" varchar(255) not null, "name" varchar(128) not null, "cron" varchar(64) not null, "timezone" varchar(64) not null default 'UTC', "is_active" boolean not null default true, "is_processing" boolean not null default false, "only_when_online" boolean not null default false, "last_run_at" timestamptz null, "next_run_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`create index "schedule_server_id_index" on "schedule" ("server_id");`);
    this.addSql(`create index "schedule_next_run_at_index" on "schedule" ("next_run_at");`);

    this.addSql(
      `create table "schedule_task" ("id" varchar(255) not null, "schedule_id" varchar(255) not null, "sequence_id" int not null, "action" varchar(16) not null, "payload" text not null, "time_offset" int not null default 0, "continue_on_failure" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "schedule_task_schedule_id_index" on "schedule_task" ("schedule_id");`,
    );

    this.addSql(`alter table "activity_log" alter column "created_at" drop default;`);

    this.addSql(
      `alter table "server_user" drop constraint "server_user_server_id_user_id_unique";`,
    );
    this.addSql(
      `alter table "server_user" add constraint "server_user_server_user_unique" unique ("server_id", "user_id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "schedule" cascade;`);
    this.addSql(`drop table if exists "schedule_task" cascade;`);

    this.addSql(`alter table "activity_log" alter column "created_at" set default now();`);

    this.addSql(`alter table "server_user" drop constraint "server_user_server_user_unique";`);
    this.addSql(
      `alter table "server_user" add constraint "server_user_server_id_user_id_unique" unique ("server_id", "user_id");`,
    );
  }
}
