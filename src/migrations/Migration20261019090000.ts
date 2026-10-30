import { Migration } from '@mikro-orm/migrations';

export class Migration20261019090000 extends Migration {
  override name = 'Migration20261019090000';

  override up(): void | Promise<void> {
    // Recipe format v3 drops the runtime/app split: runtime recipe rows
    // (json->>'type' = 'runtime') are meaningless leftovers. Recipes are
    // stored as raw JSON, so no column change is needed — legacy app
    // recipes keep their payload (they must be rewritten with a
    // docker_image before they can be installed again).
    // Referenced rows are kept: a server's recipe_id must stay valid.
    this.addSql(
      `delete from "recipe" where "json"->>'type' = 'runtime' and not exists (select 1 from "server" where "server"."recipe_id" = "recipe"."id");`,
    );
  }

  override down(): void | Promise<void> {
    // Runtime recipes are gone for good — nothing to restore.
  }
}
