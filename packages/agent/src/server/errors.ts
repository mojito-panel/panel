/** Server package business errors (mapped to HTTP codes by the router). */
export class PowerActionError extends Error {
  readonly code:
    | 'not_found'
    | 'already_running'
    | 'not_running'
    | 'crash_loop'
    | 'start_failed';

  constructor(message: string, code: PowerActionError['code']) {
    super(message);
    this.name = 'PowerActionError';
    this.code = code;
  }
}
