#!/usr/bin/env node
/**
 * Passe un utilisateur existant en rôle admin.
 *
 * Usage :
 *   node scripts/promote-admin.mjs contact@ste4d.net
 *
 * Le compte doit exister (inscription via /register).
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/promote-admin.mjs <email>');
  process.exit(1);
}

const dbPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mojito.db');
const db = new DatabaseSync(dbPath);

const user = db.prepare('SELECT id, email, role FROM user WHERE email = ?').get(email);
if (!user) {
  console.error(`Aucun compte avec l'email « ${email} » — inscris-toi d'abord via /register.`);
  process.exit(1);
}

db.exec(`UPDATE user SET role = 'admin' WHERE email = '${email.replace(/'/g, "''")}'`);
const updated = db.prepare('SELECT email, role FROM user WHERE email = ?').get(email);
db.close();

console.log(`OK : ${updated.email} → ${updated.role}`);
