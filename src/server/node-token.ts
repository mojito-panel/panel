import '@tanstack/react-start/server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Node } from '~/db/entities';
import { orm } from './orm';
import { decryptSecret } from './crypto';

/**
 * Node-token authentication of agent → panel calls (SFTP auth, the boot
 * GC server list): the agent sends the SAME shared per-node secret the
 * panel uses to call it, as a Bearer credential. Tokens are stored
 * encrypted at rest — each is decrypted and compared in constant time
 * (never string equality).
 */

/** SHA-256 of a secret — equalizes lengths for the constant-time compare. */
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Finds the node whose agent token matches the Bearer credential — null
 * when no node matches (unknown or undecryptable token).
 */
export async function findNodeByToken(bearer: string) {
  const em = orm.em;
  const nodes = await em.find(Node, {});
  const bearerHash = sha256(bearer);
  for (const node of nodes) {
    let token: string;
    try {
      token = decryptSecret(node.agentToken);
    } catch {
      continue; // undecryptable legacy row — never a match
    }
    if (timingSafeEqual(sha256(token), bearerHash)) {
      return node;
    }
  }
  return null;
}
