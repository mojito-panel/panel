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

// ─── Types inférés des entités MikroORM ───────────────────────────────────────

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

// ─── Session better-auth (user + session) ────────────────────────────────────

export interface AuthSession {
  user: IUser;
  session: ISession;
}
