import '@tanstack/react-start/server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import { initOrm } from '~/db';
import { Account, Node, Server, User } from '~/db/entities';
import { sftpAuthRequestSchema } from '~/contract';
import { toSftpPermissions } from '~/lib/permissions';
import { parseSftpUsername } from '~/lib/sftp';
import { decryptSecret } from './crypto';
import { loadServerForViewer } from './session';

/**
 * SFTP authentication endpoint logic — the ONLY agent → panel call (wings
 * POST /api/sftp/auth equivalent, see PANEL_ROUTES in the contract).
 *
 * shard's SFTP password callback POSTs the user-supplied credentials here,
 * authenticated with the node's agent token (the same shared per-node
 * secret the panel uses in the other direction). The username is
 * `{email}.{serverId}` and the password is the user's PANEL account
 * password (Pelican reuses the account password for SFTP).
 *
 * Every failure answers the SAME 403 — the panel deliberately does not
 * distinguish unknown node / unknown user / bad password / no access, so
 * the SFTP handshake never leaks which part was wrong.
 */

/** Uniform failure reply (JSON, French message shown by SFTP clients). */
function reject(): Response {
  return Response.json({ error: 'Identifiants SFTP invalides' }, { status: 403 });
}

/** SHA-256 of a secret — equalizes lengths for the constant-time compare. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Finds the node whose agent token matches the Bearer credential. Tokens
 * are stored encrypted at rest — each is decrypted and compared in
 * constant time (never string equality).
 */
async function findNodeByToken(bearer: string) {
  const orm = await initOrm();
  const em = orm.em.fork();
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

/**
 * Handles POST /api/sftp/auth. 400 on a malformed body, 403 on any
 * rejected credential, 200 with the SFTP permissions otherwise.
 */
export async function authenticateSftp(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return reject();
  }
  const bearer = authorization.slice('Bearer '.length).trim();
  if (bearer.length === 0) {
    return reject();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const parsed = sftpAuthRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const node = await findNodeByToken(bearer);
  if (!node) {
    return reject();
  }

  const connection = parseSftpUsername(parsed.data.username);
  if (!connection) {
    return reject();
  }

  const orm = await initOrm();
  const em = orm.em.fork();
  const user = await em.findOne(User, { email: connection.email.toLowerCase() });
  if (!user || user.banned) {
    return reject();
  }

  // The SFTP password IS the panel account password (credential provider).
  const account = await em.findOne(Account, {
    userId: user.id,
    providerId: 'credential',
  });
  if (!account?.password) {
    return reject();
  }
  const valid = await verifyPassword({ hash: account.password, password: parsed.data.password });
  if (!valid) {
    return reject();
  }

  // The server must live on the node that is asking (a node can never
  // authenticate a user for ANOTHER node's server).
  const server = await em.findOne(Server, { id: connection.serverId });
  if (!server || server.nodeId !== node.id) {
    return reject();
  }

  // Per-server grants: owner/admin → "*", sub-user → their file grants.
  // No grant or no file permission → no SFTP access.
  try {
    const access = await loadServerForViewer(server.id, user);
    const permissions =
      access.viewer.isOwner || access.viewer.isAdmin
        ? (['*'] as const)
        : toSftpPermissions(access.viewer.permissions);
    if (permissions.length === 0) {
      return reject();
    }
    return Response.json({ user: user.id, server: server.id, permissions });
  } catch {
    // loadServerForViewer refuses (no grant) — same uniform 403.
    return reject();
  }
}
