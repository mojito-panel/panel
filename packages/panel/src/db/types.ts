import type { InferEntity } from '@mikro-orm/core';
import type {
  User,
  Session,
  Account,
  Verification,
  Node,
  Plugin,
  Server,
  ServerAllocation,
} from './entities';

// ─── Types inferred from MikroORM entities ───────────────────────────────────────

export interface IUser extends InferEntity<typeof User> {}
export interface ISession extends InferEntity<typeof Session> {}
export interface IAccount extends InferEntity<typeof Account> {}
export interface IVerification extends InferEntity<typeof Verification> {}
export interface INode extends InferEntity<typeof Node> {}
export interface IPlugin extends InferEntity<typeof Plugin> {}
export interface IServer extends InferEntity<typeof Server> {}
export interface IServerAllocation extends InferEntity<typeof ServerAllocation> {}

export type NodeStatus = INode['status'];
export type ServerStatus = 'installing' | 'stopped' | 'running' | 'crashed';

// ─── better-auth session (serializable DTOs) ──────────────────────────────────

/**
 * Serializable versions of the user and the session — the only ones allowed to cross
 * the client boundary (SSR beforeLoad, server functions). The entity types
 * MikroORM (IUser/ISession) carry non-serializable IndexHints and remain
 * reserved for internal server use.
 */
export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

export interface AuthSession {
  user: SessionUser;
  session: SessionInfo;
}
