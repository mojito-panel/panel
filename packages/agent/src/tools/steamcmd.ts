import { join } from 'node:path';
import { createFileTail, execProcess, type ExecOptions } from '../server/installer/actions/exec';

/**
 * SteamCMD runner for the agent-managed content install.
 *
 * SteamCMD never prints its progress on a pipe — it writes it to
 * `logs/content_log.txt` in its own directory. The agent tails that file
 * and streams matching lines live (same trick as the plugin `tail` action).
 *
 * Exit code 7 = benign self-update relaunch ("Update complete, launching…")
 * — tolerated everywhere SteamCMD runs.
 */

const STEAM_SUCCESS_CODES = [0, 7];
const CONTENT_TAIL_FILTER = 'state changed|update started|Fully Installed';

/** Runs SteamCMD's own self-update (fresh tool install): `+quit` alone triggers it. */
export async function steamcmdWarmup(
  binDir: string,
  onLine?: ExecOptions['onLine'],
): Promise<void> {
  const result = await execProcess(join(binDir, 'steamcmd.exe'), ['+quit'], {
    onLine,
    timeoutMs: 600_000,
  });
  if (result.code === null || !STEAM_SUCCESS_CODES.includes(result.code)) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Mise à jour SteamCMD échouée (code ${result.code})${details ? `\n${details}` : ''}`);
  }
}

export interface SteamcmdContentParams {
  appId: string;
  /** GoldSrc/Source mod (`+app_set_config <appId> mod <mod>`). */
  mod?: string;
  /** Add `validate` to the app_update (integrity check). */
  validate: boolean;
}

/**
 * Installs/updates the game content into the server's directory:
 * `+login anonymous +app_update <appId> [+validate]`.
 * Direct spawn with an argument array — the install dir may contain spaces.
 */
export async function runSteamcmdContentInstall(
  params: SteamcmdContentParams,
  binDir: string,
  options: { installDir: string; onLine?: ExecOptions['onLine'] },
): Promise<void> {
  const exe = join(binDir, 'steamcmd.exe');
  const args = ['+force_install_dir', options.installDir, '+login', 'anonymous'];
  if (params.mod) args.push('+app_set_config', params.appId, 'mod', params.mod);
  args.push('+app_update', params.appId);
  if (params.validate) args.push('validate');
  args.push('+quit');

  const tail = createFileTail(
    join(binDir, 'logs', 'content_log.txt'),
    { filter: CONTENT_TAIL_FILTER },
    options.onLine,
  );
  try {
    const result = await execProcess(exe, args, { onLine: options.onLine });
    if (result.code === null || !STEAM_SUCCESS_CODES.includes(result.code)) {
      const details = result.stderr.trim() || result.stdout.trim();
      throw new Error(
        `Installation Steam échouée (code ${result.code}) : app ${params.appId}${details ? `\n${details}` : ''}`,
      );
    }
  } finally {
    await tail.stop();
  }
}
