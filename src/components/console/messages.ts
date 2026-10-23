import type { ConsoleMessageParams, InstallLogLine } from '~/contract';

/**
 * Console message catalog — the single source of user-facing text for the
 * console stream (install steps/logs, power actions, server online).
 *
 * The agent sends CODES + params, never formatted text: this module renders
 * the English text today and is the single place to swap when i18n lands
 * (one map per locale, same keys).
 */

type Params = ConsoleMessageParams;

/** English rendering of a byte count (raw bytes in, localized size out). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const CATALOG: Record<string, (params: Params) => string> = {
  // ─── Install lifecycle ────────────────────────────────────────────────────
  'install.start': (p) => `Installing ${p.name} (${p.steps} steps)`,
  'install.reinstall': (p) => `Reinstalling ${p.name} (${p.steps} steps)`,
  'install.done': () => 'Installation complete',
  'install.failed': (p) => `Installation failed: ${p.error}`,

  // ─── Step actions (rendered inside the "Step X/Y — …" envelope) ───────────
  'install.runtime': (p) => `Preparing runtime ${p.label}`,
  'install.steam-install': (p) => `Installing Steam content (app ${p.appId})`,
  'install.steam-validate': (p) => `Verifying Steam content (app ${p.appId})`,
  'install.action.download': (p) => `Downloading ${p.dest}`,
  'install.action.extract': (p) => `Extracting ${p.archive}`,
  'install.action.write': (p) => `Writing ${p.file}`,
  'install.action.replace': (p) => `Editing ${p.file}`,
  'install.action.configFile': (p) => `Configuring ${p.file} (${p.parser})`,
  'install.action.command': (p) => `Running: ${p.command}`,
  'install.action.script': (p) => `Running ${p.shell} script`,
  'install.action.other': (p) => p.action,

  // ─── Step results (gray log lines following a step) ───────────────────────
  'install.done.tool': (p) =>
    p.installed === 'true' ? "installed in the server's .bin" : 'already installed',
  'install.done.steam': () => 'content installed',
  'install.done.download': (p) => formatBytes(Number(p.bytes)),
  'install.done.extract': (p) => `${p.count} files extracted`,
  'install.done.exit': (p) => `done (exit code ${p.code})`,
  'install.done.file': (p) => p.path,

  // ─── Runtime events (console WS `event` messages) ─────────────────────────
  'power.start': () => 'Starting the server…',
  'power.stop': () => 'Stopping the server…',
  'power.restart': () => 'Restarting the server…',
  'power.kill': () => 'Killing the server process…',
  'server.online': () => 'Server is online',

  // ─── Port watchdog (agent audits listening sockets vs the allocation) ────
  'watchdog.violation': (p) =>
    `Watchdog: this server is listening on non-allocated ${p.protocol} port ${p.port} (PID ${p.pid}) — ` +
    'warning: the server will be killed as soon as this port is requested by another server',
  'watchdog.squat': (p) =>
    `Watchdog: allocated ${p.protocol} port ${p.port} is already in use by PID ${p.pid} (user ${p.user}) — killing the squatter`,
  'watchdog.killed': (p) =>
    `Watchdog: this server was killed — it was holding ${p.protocol} port ${p.port} reserved for another server (${p.server})`,
};

/** Emoji prefix per message code (empty string = no emoji). */
const EMOJI: Record<string, string> = {
  'install.start': '🚧',
  'install.reinstall': '🚧',
  'install.done': '🚀',
  'install.runtime': '📦',
  'power.start': '🚦',
  'power.stop': '🚦',
  'power.restart': '🚦',
  'power.kill': '🚦',
  'server.online': '🚀',
  'watchdog.violation': '🐕‍🦺',
  'watchdog.squat': '🐕‍🦺',
  'watchdog.killed': '🐕‍🦺',
};

/** Renders a coded message — null when the code is unknown (old agent). */
export function renderConsoleMessage(code: string, params?: Params): string | null {
  const render = CATALOG[code];
  if (!render) return null;
  return render(params ?? {});
}

/** Emoji prefix of a coded message ('' when none). */
export function consoleMessageEmoji(code: string): string {
  return EMOJI[code] ?? '';
}

/**
 * Plain-text rendering of an install log line (emoji included). Step lines
 * get the "Step X/Y — …" envelope; raw lines (command output) pass through.
 */
export function renderInstallLine(line: InstallLogLine): string {
  if (line.code) {
    if (line.level === 'step') {
      const emoji = consoleMessageEmoji(line.code) || '🔧';
      const action = renderConsoleMessage(line.code, line.params) ?? line.code;
      const step = line.params?.step ?? '?';
      const total = line.params?.total ?? '?';
      return `${emoji} Step ${step}/${total} — ${action}`;
    }
    const text = renderConsoleMessage(line.code, line.params) ?? line.message;
    const emoji = consoleMessageEmoji(line.code);
    return emoji ? `${emoji} ${text}` : text;
  }
  return line.message;
}
