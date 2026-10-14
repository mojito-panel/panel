import { Migration } from '@mikro-orm/migrations';

export class Migration20261013160000 extends Migration {

  override name = 'Migration20261013160000';

  override up(): void | Promise<void> {
    // Per-server CPU limit in cores (0 = unlimited). Existing servers keep
    // running unthrottled until their next edit — same semantics as the
    // agent's Job Object CPU rate (0 = no cap).
    this.addSql(`alter table "server" add column "cpu_cores" double precision not null default 0;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "server" drop column "cpu_cores";`);
  }

}
