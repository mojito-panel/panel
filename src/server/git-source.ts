import '@tanstack/react-start/server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isSshRemote } from '~/lib/ssh-key';
import { MAX_RECIPE_FILE_BYTES, RECIPE_FILE_PATTERN } from './registry-entries';

const execFileAsync = promisify(execFile);

/**
 * Git transport of the recipe marketplace (server-only). A registry is ANY
 * git repository — public https or ssh, GitHub, GitLab, Gitea, self-hosted…:
 * the SYSTEM git binary does the cloning, for every protocol (`git clone
 * --depth 1 --single-branch`) — the seamless path: it inherits the panel
 * host's git/ssh configuration (keys, `~/.ssh/config`, agent, credential
 * helpers), so private repositories work with zero auth code in the panel.
 * Git must be installed on the panel host (Git for Windows).
 *
 * The clone is depth 1 into an EPHEMERAL temp directory, the walker reads
 * the recipe files (and their optional covers), and the temp directory is
 * removed. Nothing persists between syncs: a temp directory is ~100 KB for a
 * recipes repo, and a clone lost mid-sync only means re-cloning on the next
 * one.
 */

/** Result of a registry clone: the recipe files + the resolved commit. */
export interface GitCloneResult {
  files: GitRecipeFile[];
  /** HEAD commit SHA after the clone — registry bookkeeping. */
  headSha: string;
  /** Branch name the clone resolved (registry default, or the tracked ref). */
  branch: string;
  /**
   * Cover artwork of the repository itself (base64 data URL) — the repo-root
   * `cover.png|jpg|jpeg|webp`. Null when the repo ships none.
   */
  cover: string | null;
}

/** One recipe file of a clone, with its optional vertical cover (data URL). */
export interface GitRecipeFile {
  path: string;
  content: string;
  /** Sibling cover image (cover.png/jpg/jpeg/webp), base64 data URL — null when absent or too large. */
  cover: string | null;
}

/** Upper bound of a clone — an abandoned clone is left to the OS temp cleanup. */
const CLONE_TIMEOUT_MS = 120_000;
/** Upper bound on walked files — a pathological repo must not wedge the sweep. */
const MAX_FILES = 5_000;
/** Upper bound per cover file (raw bytes, before base64) — cosmetic, never worth more. */
const MAX_COVER_BYTES = 400_000;

/** Sibling cover file names, by extension (the mime type of the data URL). */
const COVER_FILES: Record<string, string> = {
  'cover.png': 'image/png',
  'cover.jpg': 'image/jpeg',
  'cover.jpeg': 'image/jpeg',
  'cover.webp': 'image/webp',
};

/**
 * Clones a git repository (depth 1, single branch) into an ephemeral temp
 * directory and reads every recipe file it contains.
 *
 * `sshPrivateKey` (a PRIVATE registry's key, decrypted) authenticates the
 * clone of a private repository: written to an ephemeral 0600 file and
 * injected through GIT_SSH_COMMAND for every git call of this clone —
 * IdentitiesOnly so ONLY the configured key is tried (no agent fallback),
 * BatchMode so a bad key fails fast instead of prompting, accept-new so a
 * first connection trusts then pins the host key (TOFU, like a fresh CI).
 */
export async function cloneRecipeFiles(
  url: string,
  branch = '',
  sshPrivateKey: string | null = null,
): Promise<GitCloneResult> {
  const dir = await mkdtemp(join(tmpdir(), 'mojito-registry-'));

  let sshEnv: NodeJS.ProcessEnv | undefined;
  let sshDir: string | null = null;
  if (sshPrivateKey && isSshRemote(url)) {
    sshDir = await mkdtemp(join(tmpdir(), 'mojito-ssh-key-'));
    const keyFile = join(sshDir, 'deploy_key');
    const material = sshPrivateKey.replace(/\r\n/g, '\n');
    await writeFile(keyFile, material.endsWith('\n') ? material : `${material}\n`, { mode: 0o600 });
    sshEnv = {
      ...process.env,
      // Single-quoted path — the command is parsed by sh; a temp path never
      // carries a quote, and quotes defeat any `$` expansion.
      GIT_SSH_COMMAND: `ssh -i '${keyFile}' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new`,
    };
  }

  try {
    const resolved = await cloneRepository(url, branch, dir, sshEnv);
    return { files: await readRecipeFiles(dir), cover: await readRootCover(dir), ...resolved };
  } finally {
    // Best effort: an abandoned (timed-out) clone may still be writing — a
    // failed removal only leaks a temp directory until the OS cleans it.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (sshDir) await rm(sshDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Reads the REPO-ROOT cover — `cover.png`, `cover.jpg`, `cover.jpeg` or
 * `cover.webp` at the root of the clone — the registry's own artwork
 * (distinct from the per-recipe sibling covers). Base64 data URL, null when
 * the repo ships none (the UI renders a generated gradient instead).
 */
async function readRootCover(root: string): Promise<string | null> {
  for (const [name, mime] of Object.entries(COVER_FILES)) {
    try {
      const buffer = await readFile(join(root, name));
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) continue;
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      // No such file — try the next extension.
    }
  }
  return null;
}

/**
 * Reads one file of a repository clone (used by one-shot updates of recipes
 * whose source repository is no longer registered): clones, returns the raw
 * content at `path`, null when the file does not exist there.
 */
export async function readGitFile(
  url: string,
  branch: string,
  path: string,
  sshPrivateKey: string | null = null,
): Promise<string | null> {
  const { files } = await cloneRecipeFiles(url, branch === 'HEAD' ? '' : branch, sshPrivateKey);
  return files.find((file) => file.path === path)?.content ?? null;
}

/** Runs `git <args>`, mapping failures to readable errors (registry.lastError). */
async function gitExec(args: string[], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      // Inherit the environment by default (GIT_SSH_COMMAND, the ssh agent,
      // credential helpers, the panel user's ~/.ssh) — a private-registry
      // key OVERRIDES GIT_SSH_COMMAND (`sshEnv`).
      ...(env ? { env } : {}),
    });
  } catch (err) {
    const failure = err as { code?: string; stderr?: string; message?: string };
    if (failure.code === 'ENOENT') {
      throw new Error(
        'git n’est pas disponible sur le panel — les registres sont clonés avec la ' +
          'commande git (installe Git for Windows)',
      );
    }
    // A non-tty ssh never prompts: host-key or auth failures fail fast with
    // their stderr, which is the message the marketplace surfaces.
    const stderr = failure.stderr?.trim();
    throw new Error(stderr ? `git ${args[0]} : ${stderr}` : (failure.message ?? 'git a échoué'));
  }
}

/**
 * One `git clone --depth 1 --single-branch`, then HEAD and branch resolved
 * via rev-parse (branch falls back to 'HEAD' when the default ref is
 * detached — the source URLs keep working).
 */
async function cloneRepository(
  url: string,
  branch: string,
  dir: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ headSha: string; branch: string }> {
  await gitExec(
    [
      'clone',
      '--depth', '1',
      '--single-branch',
      // No --branch = the repository's default branch (the remote HEAD).
      ...(branch ? ['--branch', branch] : []),
      url,
      dir,
    ],
    env,
  );

  const { stdout: headSha } = await gitExec(['-C', dir, 'rev-parse', 'HEAD'], env);
  const { stdout: branchName } = await gitExec(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], env);

  return {
    headSha: headSha.trim(),
    branch: branchName.trim() || branch || 'HEAD',
  };
}

/** Walks a clone and reads every recipe file (POSIX paths, forward slashes). */
async function readRecipeFiles(root: string): Promise<GitRecipeFile[]> {
  const files: GitRecipeFile[] = [];

  const walk = async (rel: string): Promise<void> => {
    if (files.length >= MAX_FILES) return;
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name === '.git') continue;

      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile() && RECIPE_FILE_PATTERN.test(childRel)) {
        const content = await readFile(join(root, childRel), 'utf8');
        if (Buffer.byteLength(content, 'utf8') > MAX_RECIPE_FILE_BYTES) continue;
        files.push({ path: childRel, content, cover: await readCover(root, childRel) });
      }
    }
  };

  await walk('');
  return files;
}

/**
 * Reads the sibling cover of a recipe file — `cover.png`, `cover.jpg`,
 * `cover.jpeg` or `cover.webp` in the same directory (vertical artwork,
 * rendered on the marketplace cards). Returns a base64 data URL, null when
 * the recipe ships none (or the file exceeds the cosmetic size cap).
 */
async function readCover(root: string, recipePath: string): Promise<string | null> {
  const dir = dirname(recipePath);
  for (const [name, mime] of Object.entries(COVER_FILES)) {
    try {
      const buffer = await readFile(join(root, dir, name));
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) continue;
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      // No such file — try the next extension.
    }
  }
  return null;
}
