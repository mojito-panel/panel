import { describe, it, expect } from 'vitest';
import { clientFilterFns } from '~/components/data-table/features';

/**
 * Client-side twins of the server filters. They receive the STRING wire form
 * (`'a,b'`, `'true'`) — the value is never an array, which is exactly what a
 * naive `arrIncludesSome` would expect, so the parsing is worth pinning.
 */

/** Minimal row stub: the filter functions only read the column value. */
const rowWith = (value: unknown) => ({ getValue: () => value }) as never;

describe('client-side filters', () => {
  it('matches text case-insensitively', () => {
    expect(clientFilterFns.wireIncludesString(rowWith('Monde'), 'name', 'mond')).toBe(true);
    expect(clientFilterFns.wireIncludesString(rowWith('Monde'), 'name', 'xyz')).toBe(false);
    expect(clientFilterFns.wireIncludesString(rowWith(null), 'name', '')).toBe(true);
  });

  it('compares scalar values through their string form', () => {
    expect(clientFilterFns.wireEquals(rowWith(true), 'banned', 'true')).toBe(true);
    expect(clientFilterFns.wireEquals(rowWith('running'), 'status', 'stopped')).toBe(false);
  });

  it('splits a comma list for a multiple-choice filter', () => {
    expect(clientFilterFns.wireArrIncludesSome(rowWith(['a', 'b']), 'permissions', 'b,c')).toBe(true);
    expect(clientFilterFns.wireArrIncludesSome(rowWith(['a']), 'permissions', 'b,c')).toBe(false);
    expect(clientFilterFns.wireArrIncludesSome(rowWith('b'), 'permissions', 'b,c')).toBe(true);
    expect(clientFilterFns.wireArrIncludesSome(rowWith(['a']), 'permissions', '')).toBe(true);
  });

  it('reads a nullable column on both states', () => {
    expect(clientFilterFns.wireIsNull(rowWith(null), 'serverId', 'true')).toBe(true);
    expect(clientFilterFns.wireIsNull(rowWith(undefined), 'serverId', 'true')).toBe(true);
    expect(clientFilterFns.wireIsNull(rowWith('srv_1'), 'serverId', 'true')).toBe(false);
    expect(clientFilterFns.wireIsNull(rowWith('srv_1'), 'serverId', 'false')).toBe(true);
  });
});
