import { Migration } from '@mikro-orm/migrations';

export class Migration20261028120000 extends Migration {

  override name = 'Migration20261028120000';

  override up(): void | Promise<void> {
    // SSH key pairs managed by the panel (/admin/keys) — generated with the
    // system ssh-keygen or imported, then attached to PRIVATE registries.
    // The private key column is encrypted at rest (encryptSecret).
    this.addSql(`create table "ssh_key" ("id" varchar(255) not null, "name" varchar(128) not null, "public_key" text not null, "private_key" text not null, "fingerprint" varchar(64) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);

    // Registry → key association (loose id, like every other reference):
    // null = public https repository, or the panel host's own ssh config.
    this.addSql(`alter table "recipe_registry" add column "ssh_key_id" varchar(255) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "recipe_registry" drop column "ssh_key_id";`);
    this.addSql(`drop table if exists "ssh_key" cascade;`);
  }

}
