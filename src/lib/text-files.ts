/**
 * Editable-file whitelist for the file editor.
 *
 * ONLY these extensions may be opened in the editor — everything else
 * (binaries included) is download-only. The agent's content sniff (NUL byte
 * in the file head → binary, see the shard's files package) remains the
 * final gate: an editable-looking file that actually contains binary data
 * is refused server-side.
 */

/** Extensions the text editor can handle (for now). */
export const EDITABLE_FILE_EXTENSIONS = new Set(['txt', 'ini', 'yml', 'yaml', 'xml', 'json']);

/** Extension of a path, lowercased (no dot / dotfile → ''). */
export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  // dot === -1 (no extension) or dot === 0 (dotfile like .env) → no extension
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** True when the file may be opened in the text editor (whitelisted extension). */
export function isEditableFile(path: string): boolean {
  return EDITABLE_FILE_EXTENSIONS.has(extensionOf(path));
}
