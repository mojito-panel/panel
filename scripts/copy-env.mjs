#!/usr/bin/env node
/**
 * Copies the .env.default files to .env (without overwriting existing .env files).
 * Used by the mise task `setup:dev`.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFiles = [
  '.env.default',
  'packages/panel/.env.default',
  'packages/agent/.env.default',
];

let copied = 0;
let skipped = 0;

for (const file of envFiles) {
  const src = join(root, file);
  const dest = join(root, file.replace('.default', ''));

  if (!existsSync(src)) {
    console.warn(`[skip] ${file} — fichier source introuvable`);
    continue;
  }

  if (existsSync(dest)) {
    console.log(`[skip] ${file.replace('.default', '')} — existe déjà`);
    skipped++;
    continue;
  }

  copyFileSync(src, dest);
  console.log(`[ok]   ${file} → ${file.replace('.default', '')}`);
  copied++;
}

console.log(`\n${copied} fichier(s) copié(s), ${skipped} ignoré(s).`);
