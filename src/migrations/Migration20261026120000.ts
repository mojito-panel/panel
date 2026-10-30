import { Migration } from '@mikro-orm/migrations';

export class Migration20261026120000 extends Migration {
  override name = 'Migration20261026120000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "activity_log" (` +
        `"id" varchar(255) not null, ` +
        `"event" varchar(128) not null, ` +
        `"description" text null, ` +
        `"ip" varchar(64) null, ` +
        `"user_agent" text null, ` +
        `"actor_id" varchar(255) null, ` +
        `"actor_name" varchar(255) null, ` +
        `"actor_email" varchar(255) null, ` +
        `"server_id" varchar(255) null, ` +
        `"server_name" varchar(255) null, ` +
        `"properties" jsonb not null default '{}', ` +
        `"created_at" timestamptz not null default now()` +
        `, primary key ("id"));`,
    );
    this.addSql(
      `create index "activity_log_event_index" on "activity_log" ("event");` +
        `create index "activity_log_created_at_index" on "activity_log" ("created_at");` +
        `create index "activity_log_server_id_index" on "activity_log" ("server_id");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "activity_log";`);
  }
}
