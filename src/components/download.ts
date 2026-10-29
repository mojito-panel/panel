/**
 * Triggers a browser download of a URL — the shared mechanics of the
 * short-lived JWT links (backups, files) whose bytes stream directly from
 * the agent. A synthetic `<a download>` click keeps the current page
 * alive: `window.location.href` would navigate away and lose the app on a
 * failed download.
 *
 * Note: cross-origin downloads ignore the `download` attribute — the
 * agent's `Content-Disposition` wins and `filename` is advisory only.
 */
export function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}
