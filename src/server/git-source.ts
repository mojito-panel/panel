import '@tanstack/react-start/server-only';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { MAX_RECIPE_FILE_BYTES, RECIPE_FILE_PATTERN } from './registry-entries';

const execFileAsync = promisify(execFile);

/**
 * Git transport of the recipe marketplace (server-only). A registry is ANY
 * git repository — public https or ssh, GitHub, GitLab, Gitea, self-hosted…:
 *
 *   - https URLs clone through isomorphic-git — pure JS, no system git
 *     binary needed on the panel host;
 *   - ssh URLs (`ssh://…`, and the `git@host:path` shorthand normalized at
 *     registry-add time) clone through the SYSTEM `git clone --depth 1` —
 *     the seamless path: it inherits the panel host's git/ssh configuration
 *     (keys, `~/.ssh/config`, agent), which no pure-JS transport can honor.
 *
 * Both paths clone depth 1 into an EPHEMERAL temp directory, the walker
 * reads the recipe files (and their optional covers), and the temp directory
 * is removed. Nothing persists between syncs: a temp directory is ~100 KB
 * for a recipes repo, and a clone lost mid-sync only means re-cloning on the
 * next one.
 */

/** Result of a registry clone: the recipe files + the resolved commit. */
export interface GitCloneResult {
  files: GitRecipeFile[];
  /** HEAD commit SHA after the clone — registry bookkeeping. */
  headSha: string;
  /** Branch name the clone resolved (registry default, or the tracked ref). */
  branch: string;
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
 * Clones a git repository (depth 1) into an ephemeral temp directory and
 * reads every recipe file it contains. https goes through isomorphic-git,
 * ssh through the system git binary (see the module header).
 */
export async function cloneRecipeFiles(url: string, branch = ''): Promise<GitCloneResult> {
  const dir = await mkdtemp(join(tmpdir(), 'mojito-registry-'));
  try {
    if (url.startsWith('ssh://')) {
      const resolved = await cloneViaSystemGit(url, branch, dir);
      return { files: await readRecipeFiles(dir), ...resolved };
    }

    await withTimeout(
      git.clone({
        fs,
        http,
        dir,
        url,
        depth: 1,
        singleBranch: true,
        // No ref = the repository's default branch (the remote HEAD).
        ...(branch ? { ref: branch } : {}),
      }),
      CLONE_TIMEOUT_MS,
    );

    const headSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const branchName = (await git.currentBranch({ fs, dir, fullname: false })) ?? branch ?? 'HEAD';

    return { files: await readRecipeFiles(dir), headSha, branch: branchName };
  } finally {
    // Best effort: an abandoned (timed-out) clone may still be writing — a
    // failed removal only leaks a temp directory until the OS cleans it.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── System git (ssh transports) ─────────────────────────────────────────────

/** Runs `git <args>`, mapping failures to readable errors (registry.lastError). */
async function gitExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      // The inherited environment carries GIT_SSH_COMMAND, the ssh agent
      // and the panel user's ~/.ssh — nothing to configure here.
    });
  } catch (err) {
    const failure = err as { code?: string; stderr?: string; message?: string };
    if (failure.code === 'ENOENT') {
      throw new Error(
        'git n’est pas disponible sur le panel — requis pour les registres SSH ' +
          '(installe Git for Windows, ou utilise une URL https)',
      );
    }
    // A non-tty ssh never prompts: host-key or auth failures fail fast with
    // their stderr, which is the message the marketplace surfaces.
    const stderr = failure.stderr?.trim();
    throw new Error(stderr ? `git ${args[0]} : ${stderr}` : (failure.message ?? 'git a échoué'));
  }
}

/**
 * SSH clone via the system git binary — same shape as the isomorphic-git
 * path (depth 1, single branch, HEAD + branch resolved afterwards).
 */
async function cloneViaSystemGit(
  url: string,
  branch: string,
  dir: string,
): Promise<{ headSha: string; branch: string }> {
  await gitExec([
    'clone',
    '--depth', '1',
    '--single-branch',
    ...(branch ? ['--branch', branch] : []),
    url,
    dir,
  ]);

  const { stdout: headSha } = await gitExec(['-C', dir, 'rev-parse', 'HEAD']);
  const { stdout: branchName } = await gitExec(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);

  return {
    headSha: headSha.trim(),
    // 'HEAD' when the default ref is detached — the source URLs keep working.
    branch: branchName.trim() || branch || 'HEAD',
  };
}

/**
 * Reads one file of a repository clone (used by one-shot updates of recipes
 * whose source repository is no longer registered): clones, returns the raw
 * content at `path`, null when the file does not exist there.
 */
export async function readGitFile(url: string, branch: string, path: string): Promise<string | null> {
  const { files } = await cloneRecipeFiles(url, branch === 'HEAD' ? '' : branch);
  return files.find((file) => file.path === path)?.content ?? null;
}

/** Rejects when the promise is still pending after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Clonage interrompu : dépassé ${Math.round(ms / 1000)} s`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
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
