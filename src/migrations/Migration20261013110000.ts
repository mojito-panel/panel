import { Migration } from '@mikro-orm/migrations';

export class Migration20261013110000 extends Migration {
  override name = 'Migration20261013110000';

  override up(): void | Promise<void> {
    // Data fix — users created from the admin panel (createUserFn in
    // server/functions/users.ts) stored the credential account's account_id
    // as the user's EMAIL, but better-auth's sign-in matches on
    // account_id === user.id, so those users could not log in
    // ("invalid email or password"). Repoint the broken rows at the user id.
    // Rows created by better-auth itself (sign-up / set-password) already
    // have account_id = user_id and never match: a nanoid is never an email.
    this.addSql(
      `update "account" set "account_id" = "user_id" where "provider_id" = 'credential' and "account_id" in (select "email" from "user" where "user"."id" = "account"."user_id");`,
    );
  }

  override down(): void | Promise<void> {
    // Not reversible: credential rows created by better-auth's own sign-up /
    // set-password also have account_id = user_id and must keep it.
  }
}
