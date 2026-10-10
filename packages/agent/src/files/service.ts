import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_EDITABLE_FILE_SIZE, MAX_UPLOAD_SIZE } from '@mojito/contract';
import type { FileObject } from '@mojito/contract';
import { resolveServerPath, toRelativePosix, joinRelative } from './paths';

/** Entry (file or folder) does not exist — HTTP 404. */
export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`« ${path} » n’existe pas`);
    this.name = 'FileNotFoundError';
  }
}

/** The path exists but is a directory (or the reverse) — HTTP 400. */
export class WrongFileTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongFileTypeError';
  }
}

/** Entry already exists (create/rename target) — HTTP 409. */
export class EntryExistsError extends Error {
  constructor(path: string) {
    super(`« ${path} » existe déjà`);
    this.name = 'EntryExistsError';
  }
}

/** File above the size the file API accepts — HTTP 413. */
export class FileTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Fichier trop volumineux (max ${maxBytes} octets)`);
    this.name = 'FileTooLargeError';
  }
}

async function assertFile(absolutePath: string, displayPath: string): Promise<void> {
  const info = await stat(absolutePath).catch(() => {
    throw new FileNotFoundError(displayPath);
  });
  if (!info.isFile()) {
    throw new WrongFileTypeError(`« ${displayPath} » n’est pas un fichier`);
  }
}

/**
 * File browser service (≈ wings server/filesystem.go) — every operation is
 * sandboxed to the server's installDir by resolveServerPath.
 */
export const filesService = {
  /** Lists a directory, folders first then alphabetical. */
  async listDirectory(installDir: string, relativePath: string): Promise<FileObject[]> {
    const dir = resolveServerPath(installDir, relativePath);
    const info = await stat(dir).catch(() => {
      throw new FileNotFoundError(relativePath);
    });
    if (!info.isDirectory()) {
      throw new WrongFileTypeError(`« ${relativePath} » n’est pas un dossier`);
    }

    const entries = await readdir(dir, { withFileTypes: true });
    const displayDir = toRelativePosix(installDir, dir);

    const files: FileObject[] = [];
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const entryStat = await stat(absolute).catch(() => null);
      files.push({
        name: entry.name,
        path: joinRelative(displayDir, entry.name),
        size: entryStat?.isFile() ? entryStat.size : 0,
        isDirectory: entry.isDirectory(),
        modifiedAt: entryStat ? new Date(entryStat.mtime).toISOString() : null,
      });
    }

    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return files;
  },

  /** Reads UTF-8 text content (editor/download) — refuses oversized/binary-ish files. */
  async readFile(installDir: string, relativePath: string) {
    const absolute = resolveServerPath(installDir, relativePath);
    await assertFile(absolute, relativePath);

    const info = await stat(absolute);
    if (info.size > MAX_EDITABLE_FILE_SIZE) {
      throw new FileTooLargeError(MAX_EDITABLE_FILE_SIZE);
    }

    const content = await readFile(absolute, 'utf-8');
    return { path: relativePath, content, size: info.size };
  },

  /** Writes text content (creates parent folders as needed). */
  async writeFile(installDir: string, relativePath: string, content: string): Promise<void> {
    const absolute = resolveServerPath(installDir, relativePath);
    if (Buffer.byteLength(content, 'utf-8') > MAX_EDITABLE_FILE_SIZE) {
      throw new FileTooLargeError(MAX_EDITABLE_FILE_SIZE);
    }

    const existing = await stat(absolute).catch(() => null);
    if (existing?.isDirectory()) {
      throw new WrongFileTypeError(`« ${relativePath} » est un dossier`);
    }

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf-8');
  },

  /** Creates an empty file or a folder — refuses if the entry already exists. */
  async createEntry(
    installDir: string,
    relativePath: string,
    type: 'file' | 'directory',
  ): Promise<void> {
    const absolute = resolveServerPath(installDir, relativePath);
    if (await stat(absolute).catch(() => null)) {
      throw new EntryExistsError(relativePath);
    }

    if (type === 'directory') {
      await mkdir(absolute, { recursive: true });
    } else {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, '', 'utf-8');
    }
  },

  /** Renames/moves an entry inside the server root — refuses to overwrite. */
  async renameEntry(installDir: string, from: string, to: string): Promise<void> {
    const absoluteFrom = resolveServerPath(installDir, from);
    const absoluteTo = resolveServerPath(installDir, to);

    await assertFile(absoluteFrom, from);
    if (await stat(absoluteTo).catch(() => null)) {
      throw new EntryExistsError(to);
    }

    await mkdir(dirname(absoluteTo), { recursive: true });
    await rename(absoluteFrom, absoluteTo);
  },

  /** Deletes files/folders (recursive) — tolerant of entries already gone. */
  async deleteEntries(installDir: string, relativePaths: string[]): Promise<void> {
    const root = resolveServerPath(installDir, '');
    for (const relativePath of relativePaths) {
      const absolute = resolveServerPath(installDir, relativePath);
      if (absolute === root) {
        throw new WrongFileTypeError('Impossible de supprimer la racine du serveur');
      }
      await rm(absolute, { recursive: true, force: true });
    }
  },

  /** Writes base64-decoded bytes (upload) — enforces MAX_UPLOAD_SIZE decoded. */
  async uploadFile(installDir: string, relativePath: string, contentBase64: string): Promise<void> {
    const absolute = resolveServerPath(installDir, relativePath);
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.byteLength === 0) {
      throw new Error('Fichier vide ou encodage invalide');
    }
    if (bytes.byteLength > MAX_UPLOAD_SIZE) {
      throw new FileTooLargeError(MAX_UPLOAD_SIZE);
    }

    const existing = await stat(absolute).catch(() => null);
    if (existing?.isDirectory()) {
      throw new WrongFileTypeError(`« ${relativePath} » est un dossier`);
    }

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  },
};
