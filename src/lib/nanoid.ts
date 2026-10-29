import { webcrypto as crypto } from 'node:crypto';

/**
 * nanoid — panel-generated ids (~/lib/nanoid): 21 chars by default, same
 * URL-safe alphabet as the nanoid package. Byte-masking: each random byte
 * is masked to the alphabet's 64 symbols (`& 63`), so every byte maps to
 * a character with no rejection loop and a uniform distribution.
 */

/** URL-safe alphabet (64 symbols — matches the nanoid package default). */
const URL_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/** Random id — same output as nanoid's default (21 chars, URL-safe). */
export function nanoid(size = 21): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += URL_ALPHABET[byte & 63];
  return id;
}
