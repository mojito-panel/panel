import type { Plugin, ServerAllocationPayload } from '@mojito/contract';
import type { ServerStore, StoredServer } from '../../internal/server-store';
import { buildSystemVariables } from '../variables';
import { runInstall } from './index';
import type { InstallRegistry } from './registry';

export interface TrackedInstallOptions {
  registry: InstallRegistry;
  store: ServerStore;
  serverId: string;
  name: string;
  plugin: Plugin;
  variables: Record<string, string | number | boolean>;
  installDir: string;
  allocation: ServerAllocationPayload;
  /**
   * Existing store entry = REINSTALL (updated in place on success);
   * null = fresh install (entry created on success).
   */
  existing?: StoredServer | null;
  /** Run before the install (e.g. stop the running server on reinstall). */
  before?: () => Promise<void>;
}

/**
 * Starts a (re)install IN THE BACKGROUND and records everything in the
 * InstallRegistry: step starts, command/script output, results and errors.
 * The panel follows along by polling `GET /servers/:serverId/install`.
 *
 * On success the store entry is created (install) or refreshed (reinstall);
 * on failure the store is left untouched so the panel can retry.
 */
export function startTrackedInstall(options: TrackedInstallOptions): void {
  const { registry, store, serverId, name, plugin, variables, installDir, allocation } = options;
  const totalSteps = plugin.install.length;

  registry.start(serverId, `Installation de « ${name} » démarrée (${totalSteps} étapes)`);
  registry.update(serverId, { totalSteps });

  void (async () => {
    try {
      if (options.before) {
        registry.log(serverId, 'info', 'Arrêt du serveur en cours…');
        await options.before();
      }

      const result = await runInstall({
        plugin,
        variables,
        systemVariables: buildSystemVariables(serverId, name, installDir, allocation),
        installDir,
        onEvent: (event) => {
          switch (event.type) {
            case 'step-start':
              registry.update(serverId, {
                step: event.step + 1,
                totalSteps: event.totalSteps,
                message: event.message,
                percent: Math.round((event.step / Math.max(event.totalSteps, 1)) * 100),
              });
              registry.log(
                serverId,
                'step',
                `Étape ${event.step + 1}/${event.totalSteps} — ${event.message}`,
              );
              break;
            case 'step-output':
              registry.log(
                serverId,
                event.stream === 'stderr' ? 'error' : 'info',
                event.text,
                { rewrite: event.rewrite },
              );
              break;
            case 'step-done':
              registry.log(serverId, 'info', `→ ${event.message}`);
              break;
          }
        },
      });

      if (!result.success) {
        registry.finish(serverId, false, result.error);
        return;
      }

      if (options.existing) {
        await store.save({
          ...options.existing,
          plugin,
          variables,
          installedAt: new Date().toISOString(),
        });
      } else {
        await store.save({
          serverId,
          name,
          plugin,
          variables,
          installDir,
          allocation: { port: allocation.port, memoryMb: allocation.memoryMb, ip: allocation.ip },
          installedAt: new Date().toISOString(),
        });
      }
      registry.finish(serverId, true);
    } catch (err) {
      // before() (e.g. power action) or store persistence failure
      const message = err instanceof Error ? err.message : String(err);
      registry.finish(serverId, false, message);
    }
  })();
}
