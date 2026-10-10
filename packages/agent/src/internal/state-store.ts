import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProcessState } from '../environment/states';

/** Last known runtime state of a server, persisted for boot restore. */
export interface StoredRuntimeState {
  state: ProcessState;
  /** PID of the last known process (null when offline). */
  pid: number | null;
  /** True when the process was adopted from a previous agent run. */
  adopted: boolean;
}

/**
 * Runtime state registry (≈ wings manager.PersistStates / ReadStates):
 * `states.json` in AGENT_DATA_DIR, written on every state transition so an
 * agent restart or a hard machine reboot can restore the desired power
 * state of each server. A slightly out-of-sync file is fine — wings treats
 * it the same way, it is only here to make recovery easier.
 */
export class StateStore {
  readonly #filePath: string;
  #cache: Map<string, StoredRuntimeState> | null = null;

  constructor(dataDir: string) {
    this.#filePath = join(dataDir, 'states.json');
  }

  async #load(): Promise<Map<string, StoredRuntimeState>> {
    if (this.#cache) return this.#cache;

    const map = new Map<string, StoredRuntimeState>();
    if (existsSync(this.#filePath)) {
      try {
        const raw = JSON.parse(await readFile(this.#filePath, 'utf-8')) as Record<
          string,
          StoredRuntimeState
        >;
        for (const [serverId, entry] of Object.entries(raw)) {
          if (entry && typeof entry.state === 'string') {
            map.set(serverId, {
              state: entry.state,
              pid: entry.pid ?? null,
              adopted: entry.adopted ?? false,
            });
          }
        }
      } catch {
        // Corrupted file → assume every server offline (wings logs the same)
      }
    }
    this.#cache = map;
    return map;
  }

  async #persist(map: Map<string, StoredRuntimeState>): Promise<void> {
    const entries = Object.fromEntries(map);
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tmp = `${this.#filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
    try {
      await rename(tmp, this.#filePath);
    } catch {
      await writeFile(this.#filePath, JSON.stringify(entries, null, 2), 'utf-8');
    }
  }

  async get(serverId: string): Promise<StoredRuntimeState | null> {
    return (await this.#load()).get(serverId) ?? null;
  }

  async all(): Promise<Map<string, StoredRuntimeState>> {
    return this.#load();
  }

  async write(serverId: string, entry: StoredRuntimeState): Promise<void> {
    const map = await this.#load();
    map.set(serverId, entry);
    await this.#persist(map);
  }

  async delete(serverId: string): Promise<boolean> {
    const map = await this.#load();
    if (!map.has(serverId)) return false;
    map.delete(serverId);
    await this.#persist(map);
    return true;
  }
}
