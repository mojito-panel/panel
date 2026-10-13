import { Migration } from '@mikro-orm/migrations';

export class Migration20261013150000 extends Migration {

  override name = 'Migration20261013150000';

  override up(): void | Promise<void> {
    // Accessible port (Pelican semantics) — the port the panel and browsers
    // use to reach the agent; differs from the listen port (agent_port) when
    // a reverse proxy fronts the agent. Existing nodes expose the agent
    // directly, so their public port IS their listen port.
    this.addSql(`alter table "node" add column "public_port" integer not null default 8080;`);
    this.addSql(`update "node" set "public_port" = "agent_port";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "node" drop column "public_port";`);
  }

}
