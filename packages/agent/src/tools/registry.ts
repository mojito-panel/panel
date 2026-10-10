import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { resolveZipEntryPath } from '../server/installer/actions/extract';
import type { ExecOptions } from '../server/installer/actions/exec';
import { steamcmdWarmup } from './steamcmd';

/**
 * Tools prebuilt by the agent, ISOLATED per server inside its install
 * directory (`.bin/<tool>` — nothing shared between servers: SteamCMD may
 * cache credentials per install dir, JDKs must not collide between
 * different versions declared by two plugins):
 *   <installDir>/.bin/java/       — Microsoft OpenJDK (bin/java.exe)
 *   <installDir>/.bin/steamcmd/   — SteamCMD (steamcmd.exe)
 *
 * Idempotent: a marker file (`.mojito-tool.json`) records the installed
 * version — re-installs skip the download unless the declared version
 * changed; an in-process promise lock prevents two concurrent installs of
 * the same server dir from racing.
 */

/** Marker file written once a tool is fully installed (records the version). */
const TOOL_MARKER = '.mojito-tool.json';

/** A plugin tool, templates already rendered. */
export interface ResolvedPluginTool {
  name: 'java' | 'steamcmd';
  /** Installed version (java: major; steamcmd: none) — compared to the marker. */
  key: string;
  /** Human label for install steps/logs. */
  label: string;
  /** steamcmd only: content install parameters (undefined = PATH-only). */
  steamcmd?: { appId: string; mod?: string };
}

/** Runtime shape of an installed tool, injected into PATH + env. */
export interface ToolRuntime {
  /** Directory to prepend to PATH (contains java.exe / steamcmd.exe). */
  binDir: string;
  /** Extra environment variables (JAVA_HOME…). */
  env: Record<string, string>;
}

/** Result of an ensureTool call. */
export interface EnsureToolResult extends ToolRuntime {
  /** false = already in the server's .bin (nothing downloaded). */
  installed: boolean;
}

export interface EnsureToolOptions {
  /** Server install directory — the tool lands in its `.bin/` subfolder. */
  installDir: string;
  /** Live output callback (steamcmd warmup). */
  onLine?: ExecOptions['onLine'];
  /** Test hook: serve the tool zip from this URL instead of the official one. */
  downloadUrl?: string;
  /** Test hook: skip the steamcmd self-update warmup. */
  warmup?: boolean;
}

const JAVA_DOWNLOAD_URL = (major: string) =>
  `https://aka.ms/download-jdk/microsoft-jdk-${major}-windows-x64.zip`;
const STEAMCMD_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';

/** In-flight installs per tool directory — concurrent ensureTool calls share one. */
const pending = new Map<string, Promise<EnsureToolResult>>();

/** Tool directory: `<installDir>/.bin/<name>` (isolated per server). */
export function toolInstallDir(installDir: string, tool: ResolvedPluginTool): string {
  return join(installDir, '.bin', tool.name);
}

function buildRuntime(dir: string, tool: ResolvedPluginTool): ToolRuntime {
  if (tool.name === 'java') {
    return { binDir: join(dir, 'bin'), env: { JAVA_HOME: dir } };
  }
  return { binDir: dir, env: {} };
}

function defaultDownloadUrl(tool: ResolvedPluginTool): string {
  return tool.name === 'java' ? JAVA_DOWNLOAD_URL(tool.key) : STEAMCMD_DOWNLOAD_URL;
}

/** Marker present AND version identical → nothing to do. */
async function readMarker(dir: string): Promise<{ key: string } | null> {
  try {
    return JSON.parse(await readFile(join(dir, TOOL_MARKER), 'utf-8')) as { key: string };
  } catch {
    return null;
  }
}

/**
 * Ensures a tool is present in the server's `.bin/` — downloads and extracts
 * it on first use (or when the declared version changed), returns instantly
 * when the marker matches.
 */
export async function ensureTool(
  tool: ResolvedPluginTool,
  options: EnsureToolOptions,
): Promise<EnsureToolResult> {
  const dir = toolInstallDir(options.installDir, tool);

  const marker = await readMarker(dir);
  if (marker && marker.key === tool.key) {
    return { ...buildRuntime(dir, tool), installed: false };
  }

  let promise = pending.get(dir);
  if (!promise) {
    promise = installTool(tool, options, dir).finally(() => pending.delete(dir));
    pending.set(dir, promise);
  }
  return promise;
}

async function installTool(
  tool: ResolvedPluginTool,
  options: EnsureToolOptions,
  dir: string,
): Promise<EnsureToolResult> {
  if (process.platform !== 'win32') {
    // The agent is Windows-native (JDK/SteamCMD prebuilt URLs are win-x64 only)
    throw new Error(`L’outil ${tool.label} n’est disponible que sur Windows`);
  }
  if (tool.name === 'java' && !/^[0-9]+$/.test(tool.key)) {
    throw new Error(`Version java invalide : « ${tool.key} »`);
  }

  const url = options.downloadUrl ?? defaultDownloadUrl(tool);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Téléchargement échoué (${response.status} ${response.statusText}) : ${url}`);
  }
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));

  // Extract to <dir>.tmp, write the marker, then rename to <dir> — a failed
  // download never leaves a half-installed tool that the marker would validate
  const tmpDir = `${dir}.tmp`;
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  // java: the JDK zip has a single root folder (jdk-21.0.x+y/) — stripped
  const stripComponents = tool.name === 'java' ? 1 : 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const targetPath = resolveZipEntryPath(tmpDir, entry.entryName, stripComponents);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
  }
  await writeFile(
    join(tmpDir, TOOL_MARKER),
    JSON.stringify({ name: tool.name, key: tool.key, installedAt: new Date().toISOString() }),
    'utf-8',
  );

  await rm(dir, { recursive: true, force: true });
  try {
    await rename(tmpDir, dir);
  } catch {
    // Windows: rename over an existing dir can fail — retry after removal
    await rm(dir, { recursive: true, force: true });
    await rename(tmpDir, dir);
  }

  // Fresh SteamCMD: run its self-update once (exit 7 tolerated) — otherwise
  // the first real app_update would relaunch itself mid-install
  if (tool.name === 'steamcmd' && options.warmup !== false) {
    await steamcmdWarmup(dir, options.onLine);
  }

  return { ...buildRuntime(dir, tool), installed: true };
}
