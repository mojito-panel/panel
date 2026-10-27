#!/usr/bin/env node
/**
 * Promotes an existing user to the admin role.
 *
 * Usage :
 *   node scripts/promote-admin.mjs <email>
 *
 * The account must exist (sign-up via /register).
 */
import pg from 'pg';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/promote-admin.mjs <email>');
  process.exit(1);
}

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito',
});
await client.connect();

const user = await client.query('SELECT id, email, role FROM "user" WHERE email = $1', [email]);
if (user.rowCount === 0) {
  console.error(`Aucun compte avec l'email « ${email} » — inscris-toi d'abord via /register.`);
  await client.end();
  process.exit(1);
}

await client.query('UPDATE "user" SET role = $1 WHERE email = $2', ['admin', email]);
const updated = await client.query('SELECT email, role FROM "user" WHERE email = $1', [email]);
await client.end();

console.log(`OK : ${updated.rows[0].email} → ${updated.rows[0].role}`);
