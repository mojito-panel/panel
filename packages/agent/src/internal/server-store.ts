import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Recipe } from '@mojito/contract';

/** Persisted entry for a server installed on this agent. */
export interface StoredServer {
  serverId: string;
  name: string;
  recipe: Recipe;
  variables: Record<string, string | number | boolean>;
  installDir: string;
  allocation: { port: number; memoryMb: number; ip: string };
  installedAt: string;
}

/**
 * Local registry of installed servers (JSON in AGENT_DATA_DIR).
 * Atomic write (.tmp → rename). A process start only needs the serverId.
 */
export class ServerStore {
  readonly #filePath: string;
  #cache: Map<string, StoredServer> | null = null;

  constructor(dataDir: string) {
    this.#filePath = join(dataDir, 'servers.json');
  }

  async #load(): Promise<Map<string, StoredServer>> {
    if (this.#cache) return this.#cache;

    const map = new Map<string, StoredServer>();
    if (existsSync(this.#filePath)) {
      try {
        const raw = JSON.parse(await readFile(this.#filePath, 'utf-8')) as StoredServer[];
        for (const entry of raw) {
          map.set(entry.serverId, entry);
        }
      } catch {
        // Corrupted file → start empty rather than blocking the agent
      }
    }
    this.#cache = map;
    return map;
  }

  async #persist(map: Map<string, StoredServer>): Promise<void> {
    const entries = [...map.values()];
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tmp = `${this.#filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
    try {
      await rename(tmp, this.#filePath);
    } catch {
      await writeFile(this.#filePath, JSON.stringify(entries, null, 2), 'utf-8');
    }
  }

  async get(serverId: string): Promise<StoredServer | null> {
    return (await this.#load()).get(serverId) ?? null;
  }

  async list(): Promise<StoredServer[]> {
    return [...(await this.#load()).values()];
  }

  async save(entry: StoredServer): Promise<void> {
    const map = await this.#load();
    map.set(entry.serverId, entry);
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
