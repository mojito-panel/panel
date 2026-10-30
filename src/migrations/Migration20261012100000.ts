import { Migration } from '@mikro-orm/migrations';

export class Migration20261012100000 extends Migration {
  override name = 'Migration20261012100000';

  override up(): void | Promise<void> {
    // Username — SFTP login uses `{username}.{serverId}` instead of email.
    // Nullable: rows created before this migration have none.
    this.addSql(`alter table "user" add column "username" varchar(32) null;`);
    this.addSql(`alter table "user" add constraint "user_username_unique" unique ("username");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "user" drop constraint "user_username_unique";`);
    this.addSql(`alter table "user" drop column "username";`);
  }
}
