import { connect as tcpConnect } from 'node:net';

/**
 * Plain TCP probe of the dev database — used by the Postgres suites to
 * decide whether they run or self-skip. Deliberately NOT a MikroORM probe:
 * `MikroORM.init` + `orm.connect()` rejections (e.g. the databaseExists
 * check inside the driver) escape as unhandled rejections under Vitest and
 * turn a skip into an exit-1 failure. A socket connect is side-effect-free
 * and cannot throw past the promise.
 */

/** Default dev database (docker-compose.dev.yml / .env.default). */
const DEFAULT_DATABASE_URL = 'postgres://mojito:mojito@localhost:5432/mojito';

/** Short bound — a probe must never stall the suite. */
const PROBE_TIMEOUT_MS = 2_000;

export async function databaseReachable(
  databaseUrl: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port <= 0) return false;

  return new Promise((resolve) => {
    const socket = tcpConnect({ host: url.hostname, port });
    const finish = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
