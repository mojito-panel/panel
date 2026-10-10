import type { ServerAction } from '@mojito/contract';
import type { StoredServer } from '../internal/server-store';
import type { ServerInstance } from './server';
import { PowerActionError } from './errors';
import { resolveVariables, render } from './templating';
import { buildSystemVariables } from './variables';
import { buildToolEnv, ensurePluginTools, resolvePluginTools } from '../tools';

/**
 * Power actions (≈ wings server/power.go): start/stop/restart/kill.
 * Actions are serialized by the server's power lock; `kill` force-passes
 * the lock (a stuck process stays killable, like wings).
 */
export async function handlePowerAction(
  instance: ServerInstance,
  stored: StoredServer,
  action: ServerAction,
): Promise<void> {
  if (action === 'kill') {
    // Kill: tries the lock, but passes even if it is taken
    instance.bypassLock();
    await instance.manager.killTree();
    return;
  }

  await instance.runExclusive(() => executePowerAction(instance, stored, action));
}

async function executePowerAction(
  instance: ServerInstance,
  stored: StoredServer,
  action: ServerAction,
): Promise<void> {
  switch (action) {
    case 'start':
      if (instance.manager.isAlive()) {
        throw new PowerActionError('Le serveur est déjà en cours d’exécution', 'already_running');
      }
      await spawnServer(instance, stored);
      return;

    case 'stop':
      await instance.manager.stop();
      return;

    case 'restart':
      await instance.manager.stop();
      await spawnServer(instance, stored);
      return;

    case 'kill':
      await instance.manager.killTree();
      return;
  }
}

/**
 * Builds the templated command and spawns the process.
 * The plugin's tool features (java, steamcmd) are ensured in the server's
 * `.bin/` and injected into the environment: PATH + JAVA_HOME — the start
 * command can simply call `java`, whatever the host has installed.
 */
async function spawnServer(instance: ServerInstance, stored: StoredServer): Promise<void> {
  const plugin = stored.plugin;
  const systemVars = buildSystemVariables(
    stored.serverId,
    stored.name,
    stored.installDir,
    stored.allocation,
  );
  const resolved = resolveVariables(plugin, stored.variables, systemVars);
  const env: Record<string, string> = {};
  for (const [key, value] of resolved) {
    env[key] = value;
  }

  try {
    const tools = resolvePluginTools(plugin, resolved);
    const runtimes = await ensurePluginTools(tools, stored.installDir);
    Object.assign(env, buildToolEnv(runtimes));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PowerActionError(`Impossible de préparer les outils du serveur : ${message}`, 'start_failed');
  }

  instance.manager.spawn({
    command: render(plugin.start.command, resolved),
    cwd: stored.installDir,
    env,
    readyPattern: plugin.start.ready?.pattern,
    stop: plugin.start.stop,
  });
}
