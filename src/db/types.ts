import type { InferEntity } from '@mikro-orm/core';
import type { ServerStatus } from '~/contract';
import type {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Registry,
  RegistryEntry,
  SshKey,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
  Backup,
  Setting,
  ActivityLog,
  Schedule,
  ScheduleTask,
} from './entities';

// ─── Types inferred from MikroORM entities ───────────────────────────────────────

export interface IUser extends InferEntity<typeof User> {}
export interface ISession extends InferEntity<typeof Session> {}
export interface IAccount extends InferEntity<typeof Account> {}
export interface IVerification extends InferEntity<typeof Verification> {}
export interface INode extends InferEntity<typeof Node> {}
export interface IRecipe extends InferEntity<typeof Recipe> {}
export interface IRegistry extends InferEntity<typeof Registry> {}
export interface IRegistryEntry extends InferEntity<typeof RegistryEntry> {}
export interface ISshKey extends InferEntity<typeof SshKey> {}
export interface IServer extends InferEntity<typeof Server> {}
export interface IAllocation extends InferEntity<typeof Allocation> {}
export interface IServerUser extends InferEntity<typeof ServerUser> {}
export interface IPanelRole extends InferEntity<typeof PanelRole> {}
export interface IBackup extends InferEntity<typeof Backup> {}
export interface ISetting extends InferEntity<typeof Setting> {}
export interface IActivityLog extends InferEntity<typeof ActivityLog> {}
export interface ISchedule extends InferEntity<typeof Schedule> {}
export interface IScheduleTask extends InferEntity<typeof ScheduleTask> {}

export type NodeStatus = INode['status'];

/**
 * DB-level server status — the contract union (agent statuses, source of
 * truth `serverStatusSchema` in `src/contract/api.ts`) extended with the
 * panel-only `install_failed` state a failed install persists on the row.
 */
export type ServerStatusDb = ServerStatus | 'install_failed';

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
  username: string | null;
  email: string;
  role: string;
  /** Effective flat panel permissions of the role (built-in or custom). */
  permissions: string[];
}

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

export interface AuthSession {
  user: SessionUser;
  session: SessionInfo;
}
